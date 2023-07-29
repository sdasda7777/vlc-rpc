
const axios = require('axios');
const fs = require('fs');
const levenshtein = require("js-levenshtein");
const path = require('path');

class MusicHoardersFetcher
{
  static #services = {
    "spotify": "Spotify",
    "qobuz": "Qobuz",
    "deezer": "Deezer"
  };
  static #apiUrl = "https://covers.musichoarders.xyz/api/search";

  /** @type {!string}*/
  #cacheFilePath = path.join(__dirname, '..', '..', 'cache', 'MusicHoardersCache.json');

  /** @type {boolean} */
  #usePersistentCache;
  /** @type {!Object} #knownResults [metadataJSON][service] = {{fetchedFrom: string, artworkUrl: string, joinUrl: string}} */
  #knownResults = {};

  /**
   * @param {boolean} useFileBasedCache
   */
  constructor(usePersistentCache){
    console.log(usePersistentCache);
    this.#usePersistentCache = usePersistentCache;
    if (usePersistentCache)
    {
      // Load cache from cache file
      try {
        const cacheData = fs.readFileSync(this.#cacheFilePath, 'utf-8');
        this.#knownResults = JSON.parse(cacheData);
      }
      catch (error)
      {
        if (error.code === 'ENOENT')
        {
          // If the cache file does not exist, create an empty cache object
          console.log('Cache file not found. Starting with an empty cache.');
        }
        else
        {
          console.warn('Error loading cache from file:', error.message);
        }
      }

      process.on('exit', () => {
        // Save the cache to the file when the application exits
        this.#saveCacheToFile();
      });

      process.on('SIGINT', () => {
        // Save the cache to the file when the application is terminated using SIGINT (Ctrl+C)
        this.#saveCacheToFile();
      });
    }
  }

  #saveCacheToFile()
  {
    try {
      fs.writeFileSync(this.#cacheFilePath, JSON.stringify(this.#knownResults), 'utf-8');
      console.log('Cache saved to file.');
    }
    catch (error)
    {
      console.error('Error saving cache to file:', error.message);
    }
  }

  /**
   * Fetch artwork and join URLs if not cached, otherwise return cached
   * @param {string} service  service name, e.g. "spotify"
   * @param {Object} metadata VLC metadata
   * @returns {?{fetchedFrom: string, artworkUrl: string, joinUrl: string}}
   */
  async fetch(service, metadata)
  {
    if ((metadata.albumartist || metadata.artist) && metadata.album) {
      let metadataJSON = JSON.stringify(metadata);
      if (metadataJSON in this.#knownResults
          && service in this.#knownResults[metadataJSON])
      { // Use cached results if possible
        return this.#knownResults[metadataJSON][service];
      }
      else
      { // Otherwise make a new request
        const data = {
          artist: metadata.albumartist || metadata.artist,
          album: metadata.album,
          country: "gb", // this can be static
          sources: Object.keys(MusicHoardersFetcher.#services)
        };

        const response = await axios.post(MusicHoardersFetcher.#apiUrl,
                                          data, { headers: { 'User-Agent':'VLC-RPC V1.2' }});
        const albumsData = response.data.split("\n").map((line) => {
          try {
            if (line.trim().length > 0) {
              return JSON.parse(line);
            }
            return null;
          } catch (error) {
            console.error("Error parsing JSON:", error);
            return null;
          }
        });

        if (albumsData.length > 0)
        {
          let bestResults = {};
          albumsData.forEach((album) => {
            if (album && album.releaseInfo && album.releaseInfo.artist) {
              const albumNameScore =
                levenshtein(metadata.album.toLowerCase(), album.releaseInfo.title.toLowerCase());

              if (!bestResults[album.source] || bestResults[album.source].score > albumNameScore) {
                bestResults[album.source] = { album, score: albumNameScore };
              }
            }
          });

          for (let serviceKey in bestResults)
          {
            bestResults[serviceKey] = {
              fetchedFrom: MusicHoardersFetcher.#services[serviceKey],
              artworkUrl: bestResults[serviceKey].album.bigCoverUrl,
              joinUrl: bestResults[serviceKey].album.releaseInfo.url,
            };
          };
          //console.log(this.#lastResults);

          this.#knownResults[metadataJSON] = bestResults;
          return this.#knownResults[metadataJSON][service];
        }
      }
    }
  }
}

module.exports = MusicHoardersFetcher;
