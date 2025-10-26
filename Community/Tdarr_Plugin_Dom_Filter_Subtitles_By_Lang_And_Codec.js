// tdarrSkipTest
const details = () => ({
  id: 'Tdarr_Plugin_Dom_Filter_Subtitles_By_Lang_And_Codec',
  Stage: 'Pre-processing',
  Name: 'Filter Subtitles By Language/Codec, Remove Forced, Keep First Per Pair',
  Type: 'Video',
  Operation: 'Transcode',
  Description: `Filters subtitle streams using ffprobe data based on provided
  languages and codecs, optionally removes forced subtitles (title contains
  "forced"), and optionally keeps only the first stream per unique
  language+codec pair.

  Keeps all audio/video. Copies streams without re-encoding.`,
  Version: '1.0.0',
  Tags: 'pre-processing,subtitles,ffmpeg,filter,copy',
  Inputs: [
    {
      name: 'languages_csv',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: `Comma separated ISO language codes to keep (case-insensitive).

      Leave blank to match any language.

      Example:
      eng, spa, jpn`,
    },
    {
      name: 'codecs_csv',
      type: 'string',
      defaultValue: '',
      inputUI: { type: 'text' },
      tooltip: `Comma separated subtitle codec names to keep (ffprobe codec_name).

      Leave blank to match any codec.

      Examples:
      subrip, ass, srt, webvtt, dvb_subtitle, hdmv_pgs_subtitle`,
    },
    {
      name: 'remove_forced',
      type: 'string',
      defaultValue: 'yes',
      inputUI: { type: 'text' },
      tooltip: `Remove forced subtitles (where title contains the word "forced").

      Options:
      yes
      no

      Default: yes`,
    },
    {
      name: 'only_keep_first_per_language',
      type: 'string',
      defaultValue: 'yes',
      inputUI: { type: 'text' },
      tooltip: `If yes, keep only the first matching subtitle per unique
      language+codec pair and remove the rest.

      Example: inputs 'eng' and 'subrip' will keep at most one 'eng+subrip' stream.

      Options:
      yes
      no

      Default: yes`,
    },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  // eslint-disable-next-line no-param-reassign
  inputs = lib.loadDefaultValues(inputs, details);

  const response = {
    processFile: true,
    preset: '',
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: '',
  };

  // Validate inputs exist
  if (
    inputs.languages_csv === undefined
        || inputs.codecs_csv === undefined
        || inputs.remove_forced === undefined
        || inputs.only_keep_first_per_language === undefined
  ) {
    response.processFile = false;
    response.infoLog += '☒ Inputs not entered!\n';
    return response;
  }

  const toList = (csv) => (typeof csv === 'string' && csv.trim().length > 0
    ? csv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
    : []);

  const languagesList = toList(inputs.languages_csv);
  const codecsList = toList(inputs.codecs_csv);
  const removeForced = String(inputs.remove_forced).toLowerCase() === 'yes';
  const onlyKeepFirstPerLanguage = String(inputs.only_keep_first_per_language).toLowerCase() === 'yes';

  // Collect subtitle streams
  const allSubtitleStreams = (file.ffProbeData?.streams ?? []).filter(
    (s) => s && (s.codec_type === 'subtitle' || s.codec_type === 'subtitles'),
  );

  if (allSubtitleStreams.length === 0) {
    response.infoLog += 'No subtitle streams found. Nothing to do.\n';
    response.processFile = false;
    return response;
  }

  // Helper getters
  const getLang = (s) => {
    const lang = s?.tags?.language || s?.tags?.lang || '';
    return typeof lang === 'string' ? lang.toLowerCase() : '';
  };
  const getTitle = (s) => {
    const title = s?.tags?.title || '';
    return typeof title === 'string' ? title : '';
  };
  const getCodec = (s) => (s?.codec_name ? String(s.codec_name).toLowerCase() : '');
  const getSetKey = (s) => {
    const lang = getLang(s);
    const codec = getCodec(s);
    return `${lang}::${codec}`;
  };
  const chiSubStreamsHaveTraditionalAndChinese = (languagesList.includes('zho') || languagesList.includes('chi'))
        && allSubtitleStreams.some(
          (s) => typeof s?.tags?.title === 'string' && s.tags.title.toLowerCase().includes('simplified'),
        )
        && allSubtitleStreams.some(
          (s) => typeof s?.tags?.title === 'string' && s.tags.title.toLowerCase().includes('traditional'),
        );

  const seenPairs = new Set();
  const candidateStreams = allSubtitleStreams
    .filter((s) => {
      const lang = getLang(s);
      return languagesList.length === 0 || languagesList.includes(lang);
    })
    .filter((s) => {
      const codec = getCodec(s);
      return codecsList.length === 0 || codecsList.includes(codec);
    })
    .filter((s) => {
      if (!removeForced) return true;
      const title = getTitle(s);
      return !(typeof title === 'string' && title.toLowerCase().includes('forced'));
    })
    .filter((s) => {
      if (!onlyKeepFirstPerLanguage) return true;
      if (chiSubStreamsHaveTraditionalAndChinese
        && typeof s?.tags?.title === 'string'
         && s.tags.title.toLowerCase().includes('traditional')) return false;

      const key = getSetKey(s);
      if (seenPairs.has(key)) return false;
      seenPairs.add(key);
      return true;
    });

  // Build sets of kept vs unwanted subtitle stream indexes (ffprobe global index)
  const keptIndexes = new Set(candidateStreams.map((s) => s.index));
  const unwantedSubtitleStreams = allSubtitleStreams.filter((s) => !keptIndexes.has(s.index));

  // If nothing changes, skip processing
  if (unwantedSubtitleStreams.length === 0) {
    response.infoLog += 'No subtitle streams to remove based on criteria.\n';
    response.processFile = false;
    return response;
  }

  response.infoLog += `Keeping ${keptIndexes.size} subtitle stream(s); removing ${unwantedSubtitleStreams.length}.\n`;

  // Construct ffmpeg mapping: keep everything, then subtract unwanted subtitle streams
  const command = `-y <io> -map 0 -c copy${unwantedSubtitleStreams
    .map((s) => ` -map -0:${s.index}`)
    .join('')}`;

  response.preset = command;
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
