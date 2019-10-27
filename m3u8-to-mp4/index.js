/**
 * @description M3U8 to MP4 Converter (Event-driven)
 * @author Furkan Inanc (modified by Micael Levi)
 * @version 2.0.0
 */

const events = require('events');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

/**
 * A class to convert M3U8 to MP4
 * @class
 */
class M3u8ToMp4Converter extends events.EventEmitter {
  __emitErrorOnNextTick(err) {
    process.nextTick(() => {
      this.emit('error', err);
    });
  }

  /**
   * Sets the input file
   * @param {String} filename M3U8 file path. You can use remote URL
   * @returns {Function}
   */
  setInputFile(filename) {
    if (!filename) {
      this.__emitErrorOnNextTick( new Error('You must specify the M3U8 file address') );
      return this;
    }

    this.M3U8_FILE = filename;

    return this;
  }

  /**
   * Sets the output file
   * @param {String} filename Output file path. Has to be local :)
   * @returns {Function}
   */
  setOutputFile(filename) {
    if (!filename) {
      this.__emitErrorOnNextTick( new Error('You must specify the file path and name') );
      return this;
    }

    if (fs.existsSync(filename)) {
      this.__emitErrorOnNextTick( new Error('File exists: ' + filename) );
      return this;
    }

    this.OUTPUT_FILE = filename;

    return this;
  }

  /**
   * Starts the process.
   */
  start() {
    if (!this.M3U8_FILE || !this.OUTPUT_FILE) {
      this.__emitErrorOnNextTick( new Error('You must specify the input and the output files') );
      return this;
    }

    ffmpeg(this.M3U8_FILE)
      .outputOptions('-c copy')
      .outputOptions('-bsf:a aac_adtstoasc')
      .output(this.OUTPUT_FILE)
      .on('error', err => this.emit('error', err))
      .on('progress', progress => this.emit('progress', { ...progress, percent: (progress.percent ? progress.percent.toFixed(2) : '100.00') + '%' }))
      .on('end', () => this.emit('end'))
      .run();

    return this;
  }
}

module.exports = M3u8ToMp4Converter;
