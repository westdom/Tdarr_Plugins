// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_goof1_URL_Plex_Refresh',
  Stage: 'Post-processing',
  Name: 'Refresh Plex Via URL',
  Type: 'Video',
  Operation: 'Transcode',
  Description: `Refreshes folder containing the current file in Plex so changes are picked up properly 
                without the use of external applications or other dockers`,
  Version: '1.0',
  Tags: '3rd party,post-processing,configurable',

  Inputs: [
    {
      name: 'Url_Protocol',
      type: 'string',
      defaultValue: 'http',
      inputUI: {
        type: 'dropdown',
        options: [
          'http',
          'https',
        ],
      },
      tooltip: `
               Specified the type of request to make, http:// or https://
               \\nExample:\\n
               http
               \\nExample:\\n
               https`,
    },
    {
      name: 'Plex_Url',
      type: 'string',
      defaultValue: 'localhost',
      inputUI: {
        type: 'text',
      },
      tooltip: `
               Enter the IP address/URL for Plex.
               \\nExample:\\n
               192.168.0.10
               \\nExample:\\n
               subdomain.domain.tld`,
    },
    {
      name: 'Library_Key',
      type: 'string',
      defaultValue: '1',
      inputUI: {
        type: 'text',
      },
      tooltip: `
              Library key for the library in Plex where this content is displayed. \\n
              This number lets Plex know which library contains the current path needing a refresh. \\n
              See the below page under the 'Listing Defined Libraries' heading to find the key. \\n
              
              https://support.plex.tv/articles/201638786-plex-media-server-url-commands/ \\n
              
              *Note* If this number is wrong everything will behave as though it's
                working great but the folder will simply not be scanned. \\n\\n
              
              \\nExample:\\n
              29`,
    },
    {
      name: 'Plex_Path',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: `
              If the Plex path is not the same as the local path you may need to sub parts of the path. \\n
              Here is where you would enter the path that Plex uses to find the file. \\n
              You would only enter the part of the path that is different. \\n\\n
              If your TDarr path is: \\n
/media/local/tv/The Best Show Evaaaarr/Season 2/The Best Show Evaaaarr - S02E31 - Heck Yea HDTV-720p.mp4\\n\\n
              
              And the Plex path to the file is: \\n
/data/tv/The Best Show Evaaaarr/Season 2/The Best Show Evaaaarr - S02E31 - Heck Yea HDTV-720p.mp4 \\n
              then part you would enter here is:
               \\nExample:\\n
               /data/`,
    },
    {
      name: 'Tdarr_Path',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: `
              If the Plex path is not the same as the local path you may need to sub parts of the path. \\n
              Here is where you would enter the path that Plex uses to find the file. \\n
              You would only enter the part of the path that is different. \\n
              If your TDarr path is: \\n
/media/local/tv/The Best Show Evaaaarr/Season 2/The Best Show Evaaaarr - S02E31 - Heck Yea HDTV-720p.mp4 \\n\\n
              
              And the Plex path to the file is:\\n
              /data/tv/The Best Show Evaaaarr/Season 2/The Best Show Evaaaarr - S02E31 - Heck Yea HDTV-720p.mp4\\n
              then part you would enter here is:
               \\nExample:\\n
               /media/local/`,
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = async (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);

  const http = require('http');
  const https = require('https');

  const response = {
    file,
    removeFromDB: false,
    updateDB: false,
    processFile: false,
    infoLog: '',
  };

  const type = inputs.Url_Protocol;
  const url = inputs.Plex_Url;
  const token = inputs.Plex_Token;
  const key = inputs.Library_Key;
  const plexPath = inputs.Plex_Path;
  const tdarrPath = inputs.Tdarr_Path;
  let itemRefreshed = false;

  if (!type || !url || !token || !key) {
    throw new Error('Url_Protocol, Plex_Url, Plex_Token, and Library_Key are all required');
  }

  // Reusable helpers
  const request = (method, targetUrl) => new Promise((resolve) => {
    const redactedUrl = targetUrl.replace(token, '[redacted]');
    const handler = (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve({ statusCode: res.statusCode, data, requestedUrl: redactedUrl }); });
    };
    const onError = (e) => { resolve({ statusCode: 0, data: '', requestedUrl: redactedUrl, error: e }); };
    if (type === 'http') {
      if (method === 'GET') {
        http.get(targetUrl, handler).on('error', onError);
      } else {
        const req = http.request(targetUrl, { method }, handler);
      req.on('error', onError);
      req.end();
      }
    } else if (type === 'https') {
      if (method === 'GET') {
        https.get(targetUrl, { rejectUnauthorized: false }, handler).on('error', onError);
      } else {
        const req = https.request(targetUrl, { method, rejectUnauthorized: false }, handler);
      req.on('error', onError);
      req.end();
      }
    } else {
      resolve({ statusCode: 0, data: '', requestedUrl: redactedUrl, error: new Error(`Invalid protocol: ${type}`) });
    }
  });

  const fetchLibraryContents = async (libraryKey) => request('GET', `${baseUrl}/library/sections/${libraryKey}/all?X-Plex-Token=${token}`);
  const fetchChildren = async (ratingKey) => request('GET', `${baseUrl}/library/metadata/${encodeURIComponent(ratingKey)}/children?X-Plex-Token=${token}`);
  const refreshRatingKey = async (ratingKey) => request('PUT', `${baseUrl}/library/metadata/${encodeURIComponent(ratingKey)}/refresh?X-Plex-Token=${token}`);

  const findVideoRatingKeyByFile = (xmlText, filePath) => {
    console.log(xmlText)
    console.log('\n\n', filePath)
    const needleLocal = `file="${filePath.replace(/"/g, '\\"')}"`;
    const idxLocal = xmlText.indexOf(needleLocal);
    if (idxLocal === -1) return null;
    const videoOpenIdxLocal = xmlText.lastIndexOf('<Video ', idxLocal);
    const videoTagEndIdxLocal = xmlText.indexOf('>', videoOpenIdxLocal);
    if (videoOpenIdxLocal === -1 || videoTagEndIdxLocal === -1) return null;
    const videoOpenTagLocal = xmlText.substring(videoOpenIdxLocal, videoTagEndIdxLocal + 1);
    const rkMatchLocal = videoOpenTagLocal.match(/ratingKey="([^"]+)"/);
    return rkMatchLocal && rkMatchLocal[1] ? rkMatchLocal[1] : null;
  };

  const findShowRatingKeyByTitle = (xmlText, title) => {
    const escTitleLocal = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const titleNeedleLocal = `title="${escTitleLocal}`;
    const titleIdxLocal = xmlText.indexOf(titleNeedleLocal);
    if (titleIdxLocal === -1) return null;
    const dirOpenIdxLocal = xmlText.lastIndexOf('<Directory ', titleIdxLocal);
    const dirTagEndIdxLocal = xmlText.indexOf('>', dirOpenIdxLocal);
    if (dirOpenIdxLocal === -1 || dirTagEndIdxLocal === -1) return null;
    const dirOpenTagLocal = xmlText.substring(dirOpenIdxLocal, dirTagEndIdxLocal + 1);
    if (!/type="show"/.test(dirOpenTagLocal)) return null;
    const rkMatchDirLocal = dirOpenTagLocal.match(/ratingKey="([^"]+)"/);
    return rkMatchDirLocal && rkMatchDirLocal[1] ? rkMatchDirLocal[1] : null;
  };

  const determineSeasonIndexFromPath = (segments) => {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const seg = segments[i];
      const m = seg.match(/^Season\s+(\d+)$/i);
      if (m) return parseInt(m[1], 10);
      if (/^Specials$/i.test(seg)) return 0;
    }
    const name = segments[segments.length - 1] || '';
    const m2 = name.match(/S(\d{1,2})E\d{1,3}/i);
    if (m2) return parseInt(m2[1], 10);
    return null;
  };

  const findSeasonRatingKeyInXML = (xmlText, seasonIndex) => {
    const dirRegex = /<Directory [^>]*type="season"[^>]*>/g;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = dirRegex.exec(xmlText)) !== null) {
      const tag = match[0];
      const idxAttr = tag.match(/index="(\d+)"/);
      const titleAttr = tag.match(/title="([^"]+)"/);
      if ((idxAttr && parseInt(idxAttr[1], 10) === seasonIndex)
        || (titleAttr && titleAttr[1].toLowerCase() === `season ${seasonIndex}`.toLowerCase())
        || (seasonIndex === 0 && titleAttr && /^Specials$/i.test(titleAttr[1]))) {
        const rk = tag.match(/ratingKey="([^"]+)"/);
        if (rk) return rk[1];
      }
    }
    return null;
  };

  const checkReply = (response, statusCode, urlNoToken) => {
    if (statusCode === 200) {
      response.infoLog += '☒ Above shown folder scanned in Plex! \n';
    } else if (statusCode === 401) {
      response.infoLog += 'Plex replied that the token was not authorized on this server \n';
    } else if (statusCode === 404) {
      response.infoLog += `404 Plex not found, http/https is set properly? The URL used was 
    ${urlNoToken}[redacted] \n`;
    } else {
      response.infoLog += `There was an issue reaching Plex. The URL used was 
    ${urlNoToken}[redacted] \n`;
    }
  };

  // Compute the full file path as Plex sees it, then the folder path for fallback
  let plexFilePath = file.file;
  if ((tdarrPath && !plexPath) || (tdarrPath && plexPath)) {
    plexFilePath = plexFilePath.replace(tdarrPath, plexPath);
  } else if (!tdarrPath && plexPath) {
    plexFilePath = plexFilePath.replace(/^/, plexPath);
  }
  const plexFolderPath = plexFilePath.substring(0, plexFilePath.lastIndexOf('/'));

  response.infoLog += `Attempting to refresh Plex item for file ${plexFilePath} in library ${key}\n`;

  const baseUrl = `${type}://${url}`;

  // Always attempt to refresh by folder path (without force)
  response.infoLog += `Attempting folder refresh for ${plexFolderPath}\n`;
  const refreshUrl = `${baseUrl}/library/sections/${key}/refresh?path=${encodeURIComponent(
    plexFolderPath,
  )}&X-Plex-Token=${token}`;
  const folderRefreshResult = await request('GET', refreshUrl);
  checkReply(
    folderRefreshResult,
    refreshUrl.substring(0, refreshUrl.indexOf('X-Plex-Token')),
  );

  // Attempt to refresh the specific item
  const listResult = await fetchLibraryContents(key);
  if (listResult.statusCode === 200 && listResult.data) {
    const libraryXml = listResult.data;

    // Method 1: Find movie or episode directly by file path
    const videoRatingKey = findVideoRatingKeyByFile(libraryXml, plexFilePath);
    if (videoRatingKey) {
      const putRes = await refreshRatingKey(videoRatingKey);
      if (putRes.statusCode === 200) {
        response.infoLog += `☒ Refreshed Plex metadata for ratingKey ${videoRatingKey}\n`;
        itemRefreshed = true;
      } else {
        const errInfo = putRes.error
          ? ` Error: ${putRes.error.message || putRes.error}`
          : '';
        response.infoLog += `Attempt to refresh ratingKey ${videoRatingKey} returned status ${putRes.statusCode}. URL: ${putRes.requestedUrl}.${errInfo}\n`;
      }
    } else {
      // Method 2: Fallback for TV shows if direct file match fails
      response.infoLog +=
        'Could not locate item by file path in movie library. Trying TV show fallback...\n';
      const pathSegments = plexFilePath.split('/').filter((s) => s);
      const showTitle = pathSegments[pathSegments.length - 3] || '';
      const showRatingKey = findShowRatingKeyByTitle(libraryXml, showTitle);

      if (showRatingKey) {
        const seasonIndex = determineSeasonIndexFromPath(pathSegments);
        if (seasonIndex !== null) {
          const seasonsResult = await fetchChildren(showRatingKey);
          if (seasonsResult.statusCode === 200 && seasonsResult.data) {
            const seasonRatingKey = findSeasonRatingKeyInXML(
              seasonsResult.data,
              seasonIndex,
            );
            if (seasonRatingKey) {
              const episodesResult = await fetchChildren(seasonRatingKey);
              if (episodesResult.statusCode === 200 && episodesResult.data) {
                const epRatingKey = findVideoRatingKeyByFile(
                  episodesResult.data,
                  plexFilePath,
                );
                if (epRatingKey) {
                  const putResEp = await refreshRatingKey(epRatingKey);
                  if (putResEp.statusCode === 200) {
                    response.infoLog += `☒ Refreshed Plex metadata for episode ratingKey ${epRatingKey}\n`;
                    itemRefreshed = true;
                  } else {
                    const errInfoEp = putResEp.error
                      ? ` Error: ${putResEp.error.message || putResEp.error}`
                      : '';
                    response.infoLog += `Attempt to refresh episode ratingKey ${epRatingKey} returned status ${putResEp.statusCode}. URL: ${putResEp.requestedUrl}.${errInfoEp}\n`;
                  }
                } else {
                  response.infoLog += `Could not locate episode by file match within season ${seasonIndex}. URL: ${episodesResult.requestedUrl}\n`;
                }
              }
            } else {
              response.infoLog += `Could not determine season for show '${showTitle}'. URL: ${seasonsResult.requestedUrl}\n`;
            }
          }
        }
      }
    }
  } else if (listResult.statusCode) {
    response.infoLog += `Failed to list library contents. Status ${listResult.statusCode}. URL: ${listResult.requestedUrl}\n`;
  } else if (listResult.error) {
    response.infoLog += `Error listing library contents: ${
      listResult.error.message || listResult.error
    }\n`;
  }

  if (!itemRefreshed) {
    response.infoLog +=
      'Could not refresh a specific item. The folder scan should still pick up changes.\n';
      throw new Error(response.infoLog);
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;