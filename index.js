const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const m3u8ToMp4 = require('./m3u8-to-mp4');

const API_BASE_URL = 'https://cdn.younow.com/php/api';

/**
 *
 * @param {string} momentId
 * @returns {string}
 */
const makeM3U8RemotePath = momentId =>
  `https://hls.younow.com/momentsplaylists/live/${momentId}/${momentId}.m3u8`;


/**
 *
 * @param {string} username
 * @returns {Promise<string>}
 */
const getUserId = (username) => {
  const endpoint = `${API_BASE_URL}/channel/getInfo/user=${username}`;
  console.info('[fetch:try]', endpoint);

  return fetch(endpoint, { timeout: 1000 * 10 })
    .then(res => res.json())
    .then(data => {
      console.info('[fetch:done]', endpoint);
      return data.userId;
    });
}


/**
 *
 * @param {object} item
 * @returns {{createdAt:number, broadcastId:string, momentsIds:string[]}}
 */
function mapItem(item) {
  const itemWithMetadata = {
    createdAt: item.created * 1000,
    broadcastId: item.broadcastId,
    type: item.type,
  };

  if (item.type === 'collection' && item.momentsIds) {
    itemWithMetadata.momentsIds = item.momentsIds;
  } else if (item.type === 'moment') {
    itemWithMetadata.momentId = item.momentId;
  }

  return itemWithMetadata;
};

/**
 *
 * @param {{channelId:string, createdBefore:string, records:number}} opts
 * @returns {Promise<{hasMore:boolean, list:string[], lastCreated:number}>}
 */
async function getMoments({ channelId, createdBefore, records }) {
  const endpoint = `${API_BASE_URL}/moment/profile/channelId=${channelId}/createdBefore=${createdBefore}/records=${records}`;
  console.info('[fetch:try]', endpoint);

  const data = await fetch(endpoint, { timeout: 1000 * 20 })
    .then(res => res.json());

  console.info('[fetch:done]', endpoint);

  if (data.errorCode !== 0) {
    throw Error('Something wrong with the API.');
  }

  const list = data.items.map(mapItem);

  return {
    hasMore: data.hasMore,
    list,
    lastCreatedAt: (list[list.length - 1].createdAt),
  };
}


/**
 *
 * @param {string} inputPath
 * @param {string} outputhPath
 * @returns {Promise<>}
 */
function convertM3u8ToMp4(inputPath, outputhPath, id = '') {
  const converter = new m3u8ToMp4();
  return converter
    .setInputFile(inputPath)
    .setOutputFile(outputhPath)
    .start((progress) => {
      console.info(`[processing:${id}]`, progress.percent.toFixed(0) + '%')
    })
    .then(() => outputhPath)
    // .catch(() => outputhPath)
}


function reflect(promise) {
  return promise.then(
    value => ({ status: 'fulfilled', value }),
    error => ({ status: 'rejected', reason: error })
  );
}

const allSettledPromises = promises => Promise.all(promises.map(reflect));


const makeDirname = (createdAt, firstId, lastId) =>
  `${new Date(createdAt).toLocaleString()} -- ${firstId}:${lastId}`;

const makeDirPath = (createdAt, firstId, lastId) =>
  path.resolve('__videos__', makeDirname(createdAt, firstId, lastId));

const makeFilename = (createdAt, id, idx) => idx
  ? `${new Date(createdAt).toLocaleString()} -- (${idx}) ${id}` + '.mp4'
  : `${new Date(createdAt).toLocaleString()} -- ${id}` + '.mp4';

const makeFilePath = () => path.resolve('__videos__');



const params = {
  createdBefore: process.argv[2] || 0,
  records: process.argv[3] || 19,
  user: process.argv[4],
};


(async function start() {
  const channelId = await getUserId(params.user);

  const moments = await getMoments({
    channelId,
    createdBefore: params.createdBefore,
    records: params.records,
  });

  const whenConvert = []; // Promise list

  const enqueue = (id, outputFile) => {
    const inputPath = makeM3U8RemotePath(id);
    whenConvert.push( convertM3u8ToMp4(inputPath, outputFile, id) );
    console.info('[enqueue:done]', id);
  };

  for (const broadcast of moments.list) {
    const { type } = broadcast;

    if (type === 'collection') {
      const ids = broadcast.momentsIds;

      const outputDir = makeDirPath(broadcast.createdAt, ids[0], ids[ids.length - 1]);
      if (fs.existsSync(outputDir)) {
        console.info('[mkdir:skip]', outputDir);
      } else {
        console.info('[mkdir:try]', outputDir);
        fs.mkdirSync(outputDir);
        console.info('[mkdir:done]', outputDir);

        for (let idx=0; idx < ids.length; ++idx) {
          const id = ids[idx];
          const outputFile = path.join( outputDir, makeFilename(broadcast.createdAt, id, idx + 1) );
          enqueue(id, outputFile);
        }
      }
    } else if (type === 'moment') {
      const id = broadcast.momentId;
      const outputDir = makeFilePath();
      const outputFile = path.join( outputDir, makeFilename(broadcast.createdAt, id) );
      enqueue(id, outputFile);
    } else {
      console.info('[skip:unknown_broadcast_type]', type);
    }
  }

  return allSettledPromises(whenConvert).then(promisesDone =>
    promisesDone.filter(p => p.status !== 'fulfilled')
                .map(({ reason }) => console.info('[convert:error]', reason))
  );
}());
