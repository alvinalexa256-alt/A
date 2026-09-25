/*
 * Sports 803 Match Card Auto-Push
 *
 * Optional sidecar for the Blogger dashboard. Removing this file and its one
 * script tag leaves the dashboard's existing inline code unchanged.
 *
 * Configuration is intentionally compatible with the Match Card Generator:
 *   localStorage.s803_fburl  -> Firebase Realtime Database URL
 *   localStorage.s803_siteid -> optional database path prefix
 *
 * The default database URL matches the generator's default. Firebase database
 * rules/authentication remain the operator's responsibility, exactly as in
 * the generator.
 */
(function () {
  'use strict';

  var DEFAULT_DB_URL = 'https://sports-803-1b806-default-rtdb.firebaseio.com';
  var FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/9.23.0/';
  var sdkPromise = null;
  var dbPromise = null;
  var originalSetLog = window.setLog;

  function config() {
    var custom = window.S803_MATCH_CARD_CONFIG || {};
    var dbUrl = custom.databaseURL || localStorage.getItem('s803_fburl') || DEFAULT_DB_URL;
    var siteId = custom.siteId;
    if (siteId == null) siteId = localStorage.getItem('s803_siteid') || '';
    siteId = String(siteId).trim().replace(/^\/+|\/+$/g, '');
    return {
      databaseURL: String(dbUrl).trim().replace(/\/+$/, ''),
      pathPrefix: siteId,
      enabled: custom.enabled !== false && localStorage.getItem('s803_match_card_autopush') !== '0'
    };
  }

  function databasePath(subpath) {
    var c = config();
    return (c.pathPrefix ? c.pathPrefix + '/' : '') + subpath;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Could not load Firebase SDK: ' + src)); };
      document.head.appendChild(script);
    });
  }

  function loadFirebase() {
    if (window.firebase && window.firebase.database) return Promise.resolve(window.firebase);
    if (sdkPromise) return sdkPromise;
    sdkPromise = loadScript(FIREBASE_BASE + 'firebase-app-compat.js')
      .then(function () { return loadScript(FIREBASE_BASE + 'firebase-database-compat.js'); })
      .then(function () {
        if (!window.firebase) throw new Error('Firebase SDK unavailable');
        return window.firebase;
      });
    return sdkPromise;
  }

  function getDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = loadFirebase().then(function (firebase) {
      var c = config();
      var app = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp({ databaseURL: c.databaseURL });
      return app.database();
    });
    return dbPromise;
  }

  function sourceIdFor(event) {
    return String(event.sourceId || event.id || '');
  }

  function firebaseKey(id) {
    return String(id).replace(/[.#$\[\]\/]/g, '_');
  }

  function statusTypeFor(event) {
    var status = String(event.status || '').toLowerCase();
    if (status.indexOf('live') >= 0 || status.indexOf('progress') >= 0) return 'STATUS_IN_PROGRESS';
    if (status.indexOf('final') >= 0 || status.indexOf('finished') >= 0 || status.indexOf('complete') >= 0 || status === 'ft') return 'STATUS_FINAL';
    if (status.indexOf('postpon') >= 0) return 'STATUS_POSTPONED';
    return 'STATUS_SCHEDULED';
  }

  function statusFor(event) {
    var status = String(event.status || '').toLowerCase();
    if (status.indexOf('live') >= 0 || status.indexOf('progress') >= 0) return 'live';
    if (status.indexOf('final') >= 0 || status.indexOf('finished') >= 0 || status.indexOf('complete') >= 0 || status === 'ft') return 'ended';
    return 'upcoming';
  }

  function statusLabelFor(event) {
    var status = String(event.status || '').trim();
    if (status) return status;
    var normalized = statusFor(event);
    return normalized === 'live' ? 'LIVE' : normalized === 'ended' ? 'Ended' : 'Upcoming';
  }

  function numberOrNull(value) {
    if (value === '' || value == null || isNaN(Number(value))) return null;
    return Number(value);
  }

  function eventPayload(event, logData) {
    var sourceId = sourceIdFor(event);
    var home = event.home || {};
    var away = event.away || {};
    var homeScore = numberOrNull(home.score);
    var awayScore = numberOrNull(away.score);
    var isRacing = event.type === 'race';
    var score = isRacing ? '🏁' : (homeScore == null || awayScore == null ? '- -' : homeScore + ' - ' + awayScore);
    var kickoff = event.startTime instanceof Date ? event.startTime.toISOString() : event.startTime ? new Date(event.startTime).toISOString() : null;
    var league = event.league || {};
    var sport = event.source === 'OneBall' ? (event.type === 'match' ? 'football' : 'motorsport') : (league.sport || 'football');
    if (sport === 'soccer') sport = 'football';
    if (sport === 'racing') sport = 'motorsport';
    var espnPath = event.source === 'OneBall' ? '' : (league.sport && league.slug ? (league.sport === 'soccer' ? 'soccer' : league.sport) + '/' + league.slug : '');

    return {
      id: sourceId,
      espnId: sourceId,
      espnPath: espnPath,
      espnType: event.source === 'OneBall' ? (event.type === 'match' ? 'soccer' : 'racing') : (league.sport || 'soccer'),
      leagueId: league.id || '',
      leagueName: league.name || '',
      leagueEmoji: league.icon || league.emoji || '',
      kickoff: kickoff,
      homeName: home.name || event.name || 'Home',
      homeLogo: home.logo || '',
      awayName: away.name || '',
      awayLogo: away.logo || '',
      scoreHome: homeScore,
      scoreAway: awayScore,
      score: score,
      statusType: statusTypeFor(event),
      status: statusFor(event),
      statusLabel: statusLabelFor(event),
      isRacing: !!isRacing,
      sport: sport,
      postUrl: logData.postUrl || null,
      postSource: logData.postUrl ? 'matched' : 'none',
      channelKey: null,
      channelName: null,
      channelUrl: null,
      publishedAt: Number(logData.publishedAt || Date.now()),
      updatedAt: Date.now(),
      source: event.source || 'ESPN',
      sourceId: sourceId,
      sourceUrl: event.sourceUrl || null
    };
  }

  function pushEvent(event, logData) {
    var c = config();
    if (!c.enabled || !event || !logData || !logData.postId) return;
    var id = sourceIdFor(event);
    if (!id) return;
    getDatabase().then(function (db) {
      var ref = db.ref(databasePath('match_events/' + firebaseKey(id)));
      return ref.once('value').then(function (snapshot) {
        var existing = snapshot.exists() ? (snapshot.val() || {}) : {};
        var payload = eventPayload(event, logData);
        payload.publishedAt = existing.publishedAt || payload.publishedAt;
        return ref.update(payload);
      });
    }).then(function () {
      console.info('[Match Card Auto-Push] synced match_events/' + id);
    }).catch(function (error) {
      console.warn('[Match Card Auto-Push] Firebase write skipped:', error.message || error);
    });
  }

  // setLog is the dashboard's common post-success path for both new posts and
  // updates. Thumbnail-only calls do not include postId and are ignored.
  if (typeof originalSetLog === 'function') {
    window.setLog = function (event, data) {
      var result = originalSetLog.apply(this, arguments);
      try { pushEvent(event, data || {}); } catch (error) { console.warn('[Match Card Auto-Push] hook error:', error); }
      return result;
    };
  } else {
    console.warn('[Match Card Auto-Push] setLog was not found; sidecar inactive.');
  }

  window.Sports803MatchCardAutoPush = {
    sync: pushEvent,
    config: config,
    payload: eventPayload
  };
})();

// End of removable sidecar.
