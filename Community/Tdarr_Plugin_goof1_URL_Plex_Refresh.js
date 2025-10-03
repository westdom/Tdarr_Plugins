// List any npm dependencies which the plugin needs, they will be auto installed when the plugin runs:
module.exports.dependencies = [
  'xml-js',
];

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
  const xmlJs = require('xml-js');

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

  if (!type || !url || !token || !key) {
    throw new Error('Url_Protocol, Plex_Url, Plex_Token, and Library_Key are all required');
  }

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

  response.infoLog += `Folder refresh for ${plexFolderPath}\n`;
  await refreshFolder({ folderPath: plexFolderPath, baseUrl, key, token });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const listResult = await fetchLibraryContents({ libraryKey: key, baseUrl, token, xmlJs });
  if (!listResult.success || !listResult.data) {
    response.infoLog += `Could not fetch library contents\n`;
    throw new Error(response.infoLog);
  }
  const libraryXml = listResult.data;

  const videoResult = findVideoByFilePath({ parsedXml: libraryXml, filePath: plexFilePath });
  if (videoResult && videoResult._attributes.ratingKey) {
    response.infoLog += `Refreshing movie metadata for ${videoResult._attributes.title}\n`;
    await refreshRatingKey({ ratingKey: videoResult._attributes.ratingKey, baseUrl, token });
    return response;
  } 

  response.infoLog +=
    'Could not locate item by file path in movie library. Trying TV show...\n';

  const pathSegments = plexFilePath.split('/').filter((s) => s);
  const normalizedShowTitle = pathSegments[pathSegments.length - 3].toLowerCase().trim();
  const seasonIndex = determineSeasonIndexFromPath({ segments: pathSegments });

  response.infoLog += `Attempting to find TV show ${normalizedShowTitle}\n`;
  const showResult = findDirectoryByTitle({ parsedXml: libraryXml, title: normalizedShowTitle });
  response.infoLog += `Found TV show ${showResult._attributes.title}\n`;

  const seasonsResult = await fetchChildren({ ratingKey: showResult._attributes.ratingKey, baseUrl, token, xmlJs });
  if (!seasonsResult.success || !seasonsResult.data) {
    response.infoLog += `Could not fetch seasons contents\n`;
    throw new Error(response.infoLog);
  }

  response.infoLog += `Attempting to find season ${seasonIndex}\n`;
  const seasonRatingKey = findSeasonRatingKeyInXML({ xmlText: seasonsResult.data, seasonIndex });
  const episodesResult = await fetchChildren({ ratingKey: seasonRatingKey, baseUrl, token, xmlJs });
  if (!episodesResult.success || !episodesResult.data) {
    response.infoLog += `Could not fetch episodes contents\n`;
    throw new Error(response.infoLog);
  }

  response.infoLog += `Attempting to find episode ${plexFilePath}\n`;
  const epResult = findVideoByFilePath({ parsedXml: episodesResult.data, filePath: plexFilePath });
  response.infoLog += `Found episode S${epResult._attributes.parentIndex}E${epResult._attributes.index} - ${epResult._attributes.title}\n`;

  response.infoLog += `Refreshing episode metadata for S${epResult._attributes.parentIndex}E${epResult._attributes.index} - ${showResult._attributes.title}\n`;
  await refreshRatingKey({ ratingKey: epResult._attributes.ratingKey, baseUrl, token });

  return response;
};

const findSeasonRatingKeyInXML = ({ xmlText, seasonIndex }) => xmlText.MediaContainer[0].Directory.find((directory) => 
  directory._attributes.type === 'season' && directory._attributes.index == seasonIndex)?._attributes.ratingKey;

const determineSeasonIndexFromPath = ({ segments }) => {
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

const findDirectoryByTitle = ({ parsedXml, title }) => {
  const normalizedInputTitle = title.toLowerCase().trim();
  return parsedXml.MediaContainer[0].Directory.map((directory) => {
    directory.distance = levenshteinDistance(normalizedInputTitle, directory._attributes.title.toLowerCase());
    return directory;
  })
  .sort((a, b) => a.distance - b.distance)[0];
};

const findVideoByFilePath = ({ parsedXml, filePath }) => {
  const normalizedFilePath = filePath.toLowerCase().trim();
  return parsedXml.MediaContainer[0].Video?.map((video) => {
    video.distance = levenshteinDistance(normalizedFilePath, video.Media[0].Part[0]._attributes.file.toLowerCase());
    return video;
  })
  .sort((a, b) => a.distance - b.distance)[0];
};

const refreshRatingKey = async ({ ratingKey, baseUrl, token }) => {
  try {
    const res = await fetch(`${baseUrl}/library/metadata/${encodeURIComponent(ratingKey)}/refresh?X-Plex-Token=${token}`, { method: 'PUT' });
    if (res.status === 200) {
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    return { success: false };
  }
};

const refreshFolder = async ({ folderPath, baseUrl, key, token }) => {
  try {
    const res = await fetch(`${baseUrl}/library/sections/${key}/refresh?path=${encodeURIComponent(folderPath)}&X-Plex-Token=${token}`);
    if (res.status === 200) {
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    return { success: false };
  }
};

const fetchLibraryContents = async ({ libraryKey, baseUrl, token, xmlJs }) => {
  try {
    const res = await fetch(`${baseUrl}/library/sections/${libraryKey}/all?X-Plex-Token=${token}`);
    if (res.status === 200) {
      return { success: true, data: xmlJs.xml2js(await res.text(), { compact: true, alwaysArray: true }) };
    }
    return { success: false };
  } catch (error) {
    return { success: false };
  }
};

const fetchChildren = async ({ ratingKey, baseUrl, token, xmlJs }) => {
  try {
    const res = await fetch(`${baseUrl}/library/metadata/${encodeURIComponent(ratingKey)}/children?X-Plex-Token=${token}`);
    if (res.status === 200) {
      return { success: true, data: xmlJs.xml2js(await res.text(), { compact: true, alwaysArray: true }) };
    }
    return { success: false };
  } catch (error) {
    return { success: false };
  }
};

const levenshteinDistance = (string1, string2) => {
  // Handle edge cases
  if (string1 === string2) return 0;
  if (string1.length === 0) return string2.length;
  if (string2.length === 0) return string1.length;

  // Create a matrix to store distances
  const matrix = [];
  
  // Initialize the first row and column
  for (let i = 0; i <= string2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= string1.length; j++) {
    matrix[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= string2.length; i++) {
    for (let j = 1; j <= string1.length; j++) {
      if (string2.charAt(i - 1) === string1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[string2.length][string1.length];
}

module.exports.details = details;
module.exports.plugin = plugin;