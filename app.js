const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const m3u8ToMp4 = require('./m3u8-to-mp4');

const API_BASE_URL = 'https://api.younow.com/php/api'; // If this won't work, try change `api` to `cdn`

const params = {
  broadcastId: process.argv[2],
  createdBefore: process.argv[2], // min: 0
  records: process.argv[3], // max: 19
  channel: process.argv[4],
  pathToOutputDir: process.argv[5] || process.argv[3],
};

if (!(params.broadcastId && params.pathToOutputDir) || (process.argv.length !== 6 && process.argv.length !== 4)) {
  throw Error('Missing parameters.');
}

downloadMoments(params);



/**
 *
 * @param {string} momentId
 * @returns {string}
 */
function makeM3U8RemotePath(momentId) {
  return `https://hls.younow.com/momentsplaylists/live/${momentId}/${momentId}.m3u8`;
}


/**
 *
 * @param {string} username
 * @returns {Promise<string>}
 */
function getUserId(username) {
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
 * @typedef {{type:string,createdAt:number,momentId:string}} Moment
 */

/**
 *
 * @param {string} type
 * @param {string|number} created
 * @param {string} momentId
 * @returns {Moment}
 */
function makeMoment(type, created, momentId) {
  return {
    type,
    createdAt: (typeof created === 'string' ? created * 1000 : created),
    momentId
  };
}

/**
 *
 * @param {string} broadcastId
 * @returns {Promise<Moment[]>}
 */
async function getCollectionItems(broadcastId) {
  const endpoint = `${API_BASE_URL}/moment/collection/broadcastId=${broadcastId}`;
  console.info('[fetch:try]', endpoint);

  const data = await fetch(endpoint, { timeout: 1000 * 20 })
    .then(res => res.json());

  console.info('[fetch:done]', endpoint);

  if (!Object.keys(data.broadcaster).length) {
    console.info('[broadcast:not-found]', broadcastId);
    return;
  }

  const moments = data.moments.map(moment =>
    makeMoment(moment.momentType, moment.created, moment.momentId));

  return {
    createdAt: data.created * 1000,
    moments,
  };
}


/**
 *
 * @param {object} item
 * @returns {Promise<object>}
 */
async function mapItemToMoment(item) {
  if (item.type === 'collection') {
    const broadcast = await getCollectionItems(item.broadcastId);

    if (!broadcast) {
      return { type: 'invalid' };
    }

    return {
      type: 'captures',
      moments: broadcast.moments,
      createdAt: broadcast.createdAt,
    };
  }

  return makeMoment(item.momentType, item.created, item.momentId);
};

/**
 *
 * @param {{channelId:string, createdBefore:string, records:number}} opts
 * @returns {Promise<{hasMore:boolean, list:string[], lastCreated:number}>}
 */
async function getMomentsFromProfile({ channelId, createdBefore, records }) {
  if (records >= 19) {
    // Normalize the number of records due to YouNow's API business logic.
    records = 20; // When records is 19 the API returns 18 items but
                  // when records is 20 (or greater) the API returns 19 items.
                  // So 19 -> 20, and [any value greater than 20] -> 20.
  }

  const endpoint = `${API_BASE_URL}/moment/profile/channelId=${channelId}/createdBefore=${createdBefore}/records=${records}`;
  console.info('[fetch:try]', endpoint);

  const data = await fetch(endpoint, { timeout: 1000 * 20 })
    .then(res => res.json());

  console.info('[fetch:done]', endpoint);

  if (data.errorCode !== 0) {
    throw Error('Something wrong with the API.');
  }

  const items = await Promise.all( data.items.map(mapItemToMoment) );

  return {
    hasMore: data.hasMore,
    items,
  };
}


/**
 *
 * @param {string} inputPath
 * @param {string} outputhPath
 * @returns {Promise}
 */
function convertM3u8ToMp4(inputPath, outputhPath, id = '') {
  return new Promise((resolve, reject) => {
    const converter = new m3u8ToMp4();
    console.info('[convert:try]', inputPath);

    converter
      .setInputFile(inputPath)
      .setOutputFile(outputhPath)
      .on('progress', ({ percent, currentFps }) => {
        console.info(`[processing:${id}]`, percent, currentFps + ' fps');
      })
      .once('error', (err) => {
        // FIXME: when an error happen, it's getting stuck after reject
        console.info('[convert:error]', err.message);
        return reject({ err, id });
      })
      .once('end', () => {
        console.info('[convert:done]', id);
        return resolve(id);
      })
      .start();
  });
}


function reflect(promise) {
  return promise.then(
    value => ({ status: 'fulfilled', value }),
    err => ({ status: 'rejected', reason: err })
  );
}

function allSettledPromises(promises) {
  return Promise.all( promises.map(reflect) );
}

/**
 *
 * @param {Date} date
 * @returns {string} YYYY-MM-DD at HHhMMmSSs
 */
function dateToValidFilename(date) {
  const pad = (number) => number.toString().padStart(2, '0');

  return date.getUTCFullYear() +
    '-' + pad(date.getUTCMonth() + 1) +
    '-' + pad(date.getUTCDate()) +
    ' at ' + pad(date.getUTCHours()) + 'h' +
    '' + pad(date.getUTCMinutes()) + 'm' +
    '' + pad(date.getUTCSeconds()) + 's';
}

function makeDirname(createdAt, firstId, lastId) {
  if (firstId === lastId) {
    return `${dateToValidFilename(new Date(createdAt))} -- ${firstId}`;
  }

  return `${dateToValidFilename(new Date(createdAt))} -- ${firstId} to ${lastId}`;
}

function makeDirPath(createdAt, firstId, lastId) {
  return path.resolve(params.pathToOutputDir, makeDirname(createdAt, firstId, lastId));
}

function makeFilename(createdAt, id, idx) {
  return idx ?
      `${dateToValidFilename(new Date(createdAt))} -- (${idx}) ${id}` + '.mp4'
    : `${dateToValidFilename(new Date(createdAt))} -- ${id}` + '.mp4';
}

function makeFilePath() {
  return path.resolve(params.pathToOutputDir);
}

function initResolvers(whenConvertAll) {
  const enqueue = (id, createdAt, outputFile) => {
    console.info('[enqueue:try]', id);

    const inputPath = makeM3U8RemotePath(id);
    const whenConvert = convertM3u8ToMp4(inputPath, outputFile, id).then((args) => ({
      ...args,
      createdAt,
    }));

    whenConvertAll.push(whenConvert);

    console.info('[enqueue:done]', id);
  };

  function resolveCaptures(broadcast) {
    const moments = broadcast.moments;
    if (!moments.length) {
      console.info('[resolve-captures:nothing]', broadcast)
      return;
    }

    const firstMoment = moments[0];
    const lastMoment = moments[ moments.length - 1 ];

    const outputDir = makeDirPath(broadcast.createdAt, firstMoment.momentId, lastMoment.momentId);
    if (fs.existsSync(outputDir)) {
      console.info('[mkdir:skip]', outputDir);
    } else {

      try {
        console.info('[mkdir:try]', outputDir);
        fs.mkdirSync(outputDir);
        console.info('[mkdir:done]', outputDir);
        for (let idx=0; idx < moments.length; ++idx) {
          const { momentId: id, createdAt } = moments[idx];
          const outputFile = path.join( outputDir, makeFilename(createdAt, id, idx + 1) );
          enqueue(id, createdAt, outputFile);
        }
      } catch (err) {
        console.info('[mkdir:fail]', err.message);
      }

    }
  }

  function resolveGuest(broadcast) {
    const { momentId: id, createdAt } = broadcast;

    const outputDir = makeFilePath();
    const outputFile = path.join( outputDir, makeFilename(createdAt, id) );
    enqueue(id, createdAt, outputFile);
  }


  return {
    resolveCaptures,
    resolveGuest,
  };
}

async function handlePromisesChain(promises) {
  const promisesDone = await allSettledPromises(promises);

  const [promisesRejected, promisesFulfilled] = promisesDone.reduce((acum, curr) => {
    if (curr.status === 'rejected') {
      acum[0].push(curr);
    } else if (curr.status === 'fulfilled') {
      acum[1].push(curr);
    }
    
    return acum;
  }, [[], []]);

  
  return [
    promisesRejected,//.map(({ reason }) => console.info(reason)),
    promisesFulfilled//.map(({ value }) => console.info(value)),
  ];
}

async function donwloadAllMoments({ createdBefore, records, channel }) {
  const channelId = await getUserId(channel);

  const moments = await getMomentsFromProfile({
    channelId,
    createdBefore,
    records,
  });

  const whenConvertAll = [];
  const resolverService = initResolvers(whenConvertAll);

  for (const broadcast of moments.items) {
    if (broadcast.type === 'captures') {
      resolverService.resolveCaptures(broadcast);
    } else if (broadcast.type === 'guest') {
      resolverService.resolveGuest(broadcast);
    } else {
      console.info('[skip:unknown_moment_type]', type);
    }
  }

  return handlePromisesChain(whenConvertAll);
}


async function downloadBroadcastMoments({ broadcastId }) {
  const whenConvertAll = [];
  const resolverService = initResolvers(whenConvertAll);

  const broadcast = await getCollectionItems(broadcastId);
  if (broadcast) {
    resolverService.resolveCaptures(broadcast);

    return handlePromisesChain(whenConvertAll);
  }
}


async function downloadMoments(params) {
  if (params.channel && params.pathToOutputDir) {
    return donwloadAllMoments(params);
  } else {
    return downloadBroadcastMoments(params);
  }
}

