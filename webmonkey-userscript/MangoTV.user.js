// ==UserScript==
// @name         MangoTV
// @description  Watch videos in external player.
// @version      1.0.8
// @include      /^https?:\/\/(?:[^\.]+\.)*mgtv\.com\/[vb]\/(?:[^\/]+\/)*(\d+)\.html(?:[\?#].*)?$/
// @icon         https://w.mgtv.com/favicon.ico
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getUserAgent
// @grant        GM_setUserAgent
// @grant        GM_startIntent
// @homepage     https://github.com/warren-bank/crx-MangoTV/tree/webmonkey-userscript/es5
// @supportURL   https://github.com/warren-bank/crx-MangoTV/issues
// @downloadURL  https://github.com/warren-bank/crx-MangoTV/raw/webmonkey-userscript/es5/webmonkey-userscript/MangoTV.user.js
// @updateURL    https://github.com/warren-bank/crx-MangoTV/raw/webmonkey-userscript/es5/webmonkey-userscript/MangoTV.user.js
// @namespace    warren-bank
// @author       Warren Bank
// @copyright    Warren Bank
// ==/UserScript==

// ----------------------------------------------------------------------------- constants

var user_options = {
  "common": {
    "caption_language": "EN",             // language code (null = no captions, "DE" = Deutsch, "DR" = العربية, "EN" = English, "ES" = Español, "FIL" = Filipino, "FR" = Français, "ID" = Bahasa Indonesia, "IT" = Italiano, "JA" = 日本語, "KO" = 한국어, "MS" = Bahasa Malaysia, "PT" = Português, "RU" = Русский, "SW" = Kiswahili, "TH" = ภาษาไทย, "VI" = Tiếng Việt, "ZH_CN" = 简体中文, "ZH_HK" = 繁體中文)
    "redirect_to_best_resolution": false, // issue: when true, the caption URL is not retrieved from its API
    "if_redirect": {
      "max_resolution": 0                 // 0 = no max limit
    }
  },
  "corsproxy": {
    "video_data":   false,
    "caption_data": true
  },
  "developer": {
    "debug": true,
  },
  "webmonkey": {
    "firefox_useragent":            "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    "post_intent_redirect_to_url":  function() {return user_options.common.redirect_to_best_resolution ? "about:blank" : null}
  },
  "greasemonkey": {
    "redirect_to_webcast_reloaded": true,
    "force_http":                   true,
    "force_https":                  false
  }
}

var api_querystring_params = {
  "constants": {
    "abroad": 10, // language code (10 = English, 0 = Chinese)
  },
  "dynamic": {
    "api_data":               function() {return '&did=' + state.did + '&abroad=' + api_querystring_params.constants.abroad + '&_support=10000000&allowedRC=1&type=pch5&auth_mode=1&src=intelmgtv&cxid='},
    "stream_data":            function() {return                       '&abroad=' + api_querystring_params.constants.abroad + '&_support=10000000&allowedRC=1&type=pch5&auth_mode=1&src=intelmgtv&cxid=' + '&supportMse=1'},
    "video_data":             function() {return '&did=' + state.did},
    "caption_languages_data": function() {return                                                                              '&_support=10000000&allowedRC=1'},
    "caption_data":           function() {return ''}
  }
}

var state = {
  video_id:       null,
  did:            null,
  tk2:            null,
  pm2:            null,
  streams:        null,
  stream_domains: null,
  caption_url:    null,
  drm:            null, // TODO: haven't found any videos that populate this object with values.. will need to integrate them into: video_data.drm
  info: {
    series: {
      title:      null,
      id:         null
    },
    episode: {
      title:      null
    }
  }
}

// ----------------------------------------------------------------------------- helpers (state)

var encode_tk2 = function(){
  // https://stackoverflow.com/questions/105034/how-to-create-guid-uuid
  // https://github.com/kuoruan/es-packages/blob/master/packages/uuidv4/src/index.ts
  function UUIDv4() {
    var d = new Date().getTime();
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      d += performance.now(); // use high-precision timer if available
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function urlSafeBase64Encode(input) {
    return btoa(input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  }

  state.did = UUIDv4();
  var timestamp = Math.floor(Date.now() / 1000);

  var inputStr = 'did=' + state.did + '|pno=1030|ver=0.3.0301|clit=' + timestamp;
  var encoded = urlSafeBase64Encode(inputStr);
  var reversed = encoded.split('').reverse().join('');

  state.tk2 = reversed;
}

// ----------------------------------------------------------------------------- helpers (xhr)

var serialize_xhr_body_object = function(data) {
  if (typeof data === 'string')
    return data

  if (!(data instanceof Object))
    return null

  var body = []
  var keys = Object.keys(data)
  var key, val
  for (var i=0; i < keys.length; i++) {
    key = keys[i]
    val = data[key]
    val = encodeURIComponent(val)

    body.push(key + '=' + val)
  }
  body = body.join('&')
  return body
}

var download_text = function(url, headers, data, callback) {
  if (data) {
    if (!headers)
      headers = {}
    if (!headers['content-type'])
      headers['content-type'] = 'application/x-www-form-urlencoded'

    switch(headers['content-type'].toLowerCase()) {
      case 'application/json':
        data = JSON.stringify(data)
        break

      case 'application/x-www-form-urlencoded':
      default:
        data = serialize_xhr_body_object(data)
        break
    }
  }

  var xhr    = new unsafeWindow.XMLHttpRequest()
  var method = data ? 'POST' : 'GET'

  xhr.open(method, url, true, null, null)

  if (headers && (typeof headers === 'object')) {
    var keys = Object.keys(headers)
    var key, val
    for (var i=0; i < keys.length; i++) {
      key = keys[i]
      val = headers[key]
      xhr.setRequestHeader(key, val)
    }
  }

  xhr.onload = function(e) {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        callback(null, xhr.responseText)
      }
    }
  }

  xhr.onerror = function(error) {
    callback(error)
  }

  if (data)
    xhr.send(data)
  else
    xhr.send()
}

var download_json = function(url, headers, data, callback) {
  if (!headers)
    headers = {}
  if (!headers.accept)
    headers.accept = 'application/json'

  download_text(url, headers, data, function(error, text){
    if (error) {
      callback(error)
    }
    else {
      try {
        callback(null, JSON.parse(text))
      }
      catch(e) {
        callback(e)
      }
    }
  })
}

// ----------------------------------------------------------------------------- helpers (corsproxy)

var corsproxy = function(url) {
  return 'https://cors-yt-dlp-web-console.warren-bank.workers.dev/?key=warren-bank&url=' + encodeURIComponent(url)
}

// ----------------------------------------------------------------------------- helpers (API)

var download_api_data = function(callback) {
  var api_url = 'https://pcweb.api.mgtv.com/player/video?video_id=' + state.video_id + '&tk2=' + state.tk2 + api_querystring_params.dynamic.api_data()

  download_json(api_url, null, null, function(error, api_data){
    if (user_options.developer.debug)
      console.log('api_data:', error || JSON.stringify(api_data, null, 2))

    if (error) return

    try {
      state.pm2 = api_data['data']['atc']['pm2']

      if (state.pm2) {
        try {
          state.drm = api_data['data']['drm']
        }
        catch(e2) {}

        try {
          state.info.episode.title = api_data['data']['info']['desc']
          state.info.series.title  = api_data['data']['info']['title']
          state.info.series.id     = api_data['data']['info']['collection_id']
        }
        catch(e3) {}
      }

      if (state.pm2)
        callback()
    }
    catch(e) {}
  })
}

var download_stream_data = function(callback) {
  var api_url = 'https://pcweb.api.mgtv.com/player/getSource?video_id=' + state.video_id + '&tk2=' + state.tk2 + '&pm2=' + state.pm2 + api_querystring_params.dynamic.stream_data()

  download_json(api_url, null, null, function(error, stream_data){
    var streams

    if (user_options.developer.debug)
      console.log('stream_data:', error || JSON.stringify(stream_data, null, 2))

    if (error) return

    try {
      streams = stream_data['data']['stream']

      if (!streams || !Array.isArray(streams) || !streams.length)
        return

      streams = streams.filter(function(stream){
        if (!stream.url) return false

        if (
          user_options.common.redirect_to_best_resolution &&
          user_options.common.if_redirect.max_resolution  &&
          (Number(stream.filebitrate) > user_options.common.if_redirect.max_resolution)
        ) return false

        return true
      })

      if (!streams.length)
        return

      // sort by bitrate, descending
      streams.sort(function(a, b){
        var abr = Number(a.filebitrate)
        var bbr = Number(b.filebitrate)
        return (bbr - abr)
      })

      state.streams = streams
      state.stream_domains = stream_data['data']['stream_domain'] || []

      if (user_options.common.redirect_to_best_resolution) {
        download_video_data(process_video_url, 0)
      }
      else {
        callback()
      }
    }
    catch(e) {}
  })
}

var download_video_data = function(callback, stream_index, stream_domain_index) {
  stream_index = stream_index || 0
  stream_domain_index = stream_domain_index || 0
  if (stream_index >= state.streams.length) return
  if (stream_domain_index >= state.stream_domains.length) return

  var api_url = state.stream_domains[stream_domain_index] + state.streams[stream_index].url + api_querystring_params.dynamic.video_data()

  if (user_options.corsproxy.video_data)
    api_url = corsproxy(api_url)

  download_json(api_url, null, null, function(error, video_data){
    var video_url

    if (user_options.developer.debug)
      console.log('video_data:', error || JSON.stringify(video_data, null, 2))

    try {
      if (error) throw error

      video_url = video_data.info

      if (video_url === 'busy')
        throw 'busy'

      if (video_url)
        callback(video_url, null, state.caption_url)
    }
    catch(e) {
      download_video_data(callback, stream_index, stream_domain_index + 1)
    }
  })
}

var download_caption_languages_data = function(callback) {
  if (!user_options.common.caption_language) return

  var api_url = 'https://pcweb.api.mgtv.com/video/title?videoId=' + state.video_id + api_querystring_params.dynamic.caption_languages_data()

  download_json(api_url, null, null, function(error, caption_languages_data){
    if (user_options.developer.debug)
      console.log('caption_languages_data:', error || JSON.stringify(caption_languages_data, null, 2))

    if (error) return

    try {
      caption_languages_data = caption_languages_data['data']['title']
        .filter(function(caption){
          return caption && (typeof caption === 'object') && caption.url && (caption.captionSimpleName === user_options.common.caption_language)
        })

      if (caption_languages_data.length === 1)
        callback(caption_languages_data[0]['url'])
    }
    catch(e) {}
  })
}

var download_caption_data = function(api_url_pathname, stream_domain_index) {
  stream_domain_index = stream_domain_index || 0
  if (stream_domain_index >= state.stream_domains.length) return

  var api_url = state.stream_domains[stream_domain_index] + api_url_pathname + api_querystring_params.dynamic.caption_data()

  if (user_options.corsproxy.caption_data)
    api_url = corsproxy(api_url)

  download_json(api_url, null, null, function(error, caption_data){
    var caption_url

    if (user_options.developer.debug)
      console.log('caption_data:', error || JSON.stringify(caption_data, null, 2))

    try {
      if (error) throw error

      caption_url = caption_data.info

      if (caption_url === 'busy')
        throw 'busy'

      if (caption_url)
        state.caption_url = caption_url
    }
    catch(e) {
      download_caption_data(api_url_pathname, stream_domain_index + 1)
    }
  })
}

// ----------------------------------------------------------------------------- URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url = function(video_url, caption_url, referer_url, force_http, force_https) {
  force_http  = (typeof force_http  === 'boolean') ? force_http  : user_options.greasemonkey.force_http
  force_https = (typeof force_https === 'boolean') ? force_https : user_options.greasemonkey.force_https

  var encoded_video_url, encoded_caption_url, encoded_referer_url, webcast_reloaded_base, webcast_reloaded_url

  encoded_video_url     = encodeURIComponent(encodeURIComponent(btoa(video_url)))
  encoded_caption_url   = caption_url ? encodeURIComponent(encodeURIComponent(btoa(caption_url))) : null
  referer_url           = referer_url ? referer_url : unsafeWindow.location.href
  encoded_referer_url   = encodeURIComponent(encodeURIComponent(btoa(referer_url)))

  webcast_reloaded_base = {
    "https": "https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html",
    "http":  "http://webcast-reloaded.frii.site/index.html"
  }

  webcast_reloaded_base = (force_http)
                            ? webcast_reloaded_base.http
                            : (force_https)
                               ? webcast_reloaded_base.https
                               : (video_url.toLowerCase().indexOf('http:') === 0)
                                  ? webcast_reloaded_base.http
                                  : webcast_reloaded_base.https

  webcast_reloaded_url  = webcast_reloaded_base + '#/watch/' + encoded_video_url + (encoded_caption_url ? ('/subtitle/' + encoded_caption_url) : '') + '/referer/' + encoded_referer_url
  return webcast_reloaded_url
}

// ----------------------------------------------------------------------------- URL redirect

var determine_video_type = function(video_url) {
  if (!video_url) return null

  var video_url_regex_pattern = /^.*\.(mp4|mp4v|mpv|m1v|m4v|mpg|mpg2|mpeg|xvid|webm|3gp|avi|mov|mkv|ogv|ogm|m3u8|mpd|ism(?:[vc]|\/manifest)?)(?:[\?#].*)?$/i
  var matches, file_ext, video_type

  matches = video_url_regex_pattern.exec(video_url)

  if (matches && matches.length)
    file_ext = matches[1]

  if (file_ext) {
    switch (file_ext) {
      case "mp4":
      case "mp4v":
      case "m4v":
        video_type = "video/mp4"
        break
      case "mpv":
        video_type = "video/MPV"
        break
      case "m1v":
      case "mpg":
      case "mpg2":
      case "mpeg":
        video_type = "video/mpeg"
        break
      case "xvid":
        video_type = "video/x-xvid"
        break
      case "webm":
        video_type = "video/webm"
        break
      case "3gp":
        video_type = "video/3gpp"
        break
      case "avi":
        video_type = "video/x-msvideo"
        break
      case "mov":
        video_type = "video/quicktime"
        break
      case "mkv":
        video_type = "video/x-mkv"
        break
      case "ogg":
      case "ogv":
      case "ogm":
        video_type = "video/ogg"
        break
      case "m3u8":
        video_type = "application/x-mpegURL"
        break
      case "mpd":
        video_type = "application/dash+xml"
        break
      case "ism":
      case "ism/manifest":
      case "ismv":
      case "ismc":
        video_type = "application/vnd.ms-sstr+xml"
        break
    }
  }

  return video_type ? video_type.toLowerCase() : ""
}

var redirect_to_url = function(url) {
  if (!url) return

  try {
    unsafeWindow.top.location = url
  }
  catch(e) {
    unsafeWindow.window.location = url
  }
}

var process_webmonkey_post_intent_redirect_to_url = function() {
  var url = null

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'string')
    url = user_options.webmonkey.post_intent_redirect_to_url

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'function')
    url = user_options.webmonkey.post_intent_redirect_to_url()

  if (typeof url === 'string')
    redirect_to_url(url)
}

var process_video_data = function(data) {
  if (!data.video_url) return

  if (!data.referer_url)
    data.referer_url = unsafeWindow.location.href

  if (typeof GM_startIntent === 'function') {
    // running in Android-WebMonkey: open Intent chooser

    if (!data.video_type)
      data.video_type = determine_video_type(data.video_url)

    var args = [
      /* action = */ 'android.intent.action.VIEW',
      /* data   = */ data.video_url,
      /* type   = */ data.video_type
    ]

    // extras:
    if (data.caption_url) {
      args.push('textUrl')
      args.push(data.caption_url)
    }
    if (data.referer_url) {
      args.push('referUrl')
      args.push(data.referer_url)
    }
    if (data.drm.scheme) {
      args.push('drmScheme')
      args.push(data.drm.scheme)
    }
    if (data.drm.server) {
      args.push('drmUrl')
      args.push(data.drm.server)
    }
    if (data.drm.headers && (typeof data.drm.headers === 'object')) {
      var drm_header_keys, drm_header_key, drm_header_val

      drm_header_keys = Object.keys(data.drm.headers)
      for (var i=0; i < drm_header_keys.length; i++) {
        drm_header_key = drm_header_keys[i]
        drm_header_val = data.drm.headers[drm_header_key]

        args.push('drmHeader')
        args.push(drm_header_key + ': ' + drm_header_val)
      }
    }

    GM_startIntent.apply(this, args)
    process_webmonkey_post_intent_redirect_to_url()
    return true
  }
  else if (user_options.greasemonkey.redirect_to_webcast_reloaded) {
    // running in standard web browser: redirect URL to top-level tool on Webcast Reloaded website

    redirect_to_url(get_webcast_reloaded_url(data.video_url, data.caption_url, data.referer_url))
    return true
  }
  else {
    return false
  }
}

// -------------------------------------

var process_hls_data = function(data) {
  data.video_type = 'application/x-mpegurl'
  process_video_data(data)
}

var process_dash_data = function(data) {
  data.video_type = 'application/dash+xml'
  process_video_data(data)
}

// -------------------------------------

var process_video_url = function(video_url, video_type, caption_url, referer_url) {
  var data = {
    drm: {
      scheme:    null,
      server:    null,
      headers:   null
    },
    video_url:   video_url   || null,
    video_type:  video_type  || null,
    caption_url: caption_url || null,
    referer_url: referer_url || null
  }

  process_video_data(data)
}

var process_hls_url = function(video_url, caption_url, referer_url) {
  process_video_url(video_url, /* video_type= */ 'application/x-mpegurl', caption_url, referer_url)
}

var process_dash_url = function(video_url, caption_url, referer_url) {
  process_video_url(video_url, /* video_type= */ 'application/dash+xml', caption_url, referer_url)
}

// ----------------------------------------------------------------------------- rewrite DOM to display all available streams

// ------------------------------------- constants

var strings = {
  "button_download_video":          "Get Video URL",
  "button_start_video":             "Start Video",
  "button_unavailable_video":       "Video Is Not Available",
  "stream_labels": {
    "title":                        "Resolution:"
  }
}

var constants = {
  "dom_classes": {
    "div_streams":                  "streams",
    "div_webcast_icons":            "icons-container"
  },
  "img_urls": {
    "base_webcast_reloaded_icons":  "https://github.com/warren-bank/crx-webcast-reloaded/raw/gh-pages/chrome_extension/2-release/popup/img/"
  }
}

// -------------------------------------  URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url_chromecast_sender = function(video_url, caption_url, referer_url) {
  return get_webcast_reloaded_url(video_url, caption_url, referer_url, /* force_http= */ null, /* force_https= */ null).replace('/index.html', '/chromecast_sender.html')
}

var get_webcast_reloaded_url_airplay_sender = function(video_url, caption_url, referer_url) {
  return get_webcast_reloaded_url(video_url, caption_url, referer_url, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/airplay_sender.es5.html')
}

var get_webcast_reloaded_url_proxy = function(hls_url, caption_url, referer_url) {
  return get_webcast_reloaded_url(hls_url, caption_url, referer_url, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/proxy.html')
}

// -------------------------------------  DOM: static skeleton

var reset_dom = function() {
  unsafeWindow.document.close()
  unsafeWindow.document.write('')
  unsafeWindow.document.close()
}

var reinitialize_dom = function() {
  reset_dom()

  var head = unsafeWindow.document.getElementsByTagName('head')[0]
  var body = unsafeWindow.document.body

  var html = {
    "head": [
      '<meta name="referrer" content="strict-origin-when-cross-origin" />',
      '<style>',

      // --------------------------------------------------- CSS: global

      'body {',
      '  background-color: #fff !important;',
      '  text-align: left;',
      '}',

      'body > * {',
      '  display: none !important;',
      '}',

      'body > div.' + constants.dom_classes.div_streams + ' {',
      '  display: block !important;',
      '}',

      // --------------------------------------------------- series title

      'div.' + constants.dom_classes.div_streams + ' > h2 {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0.5em;',
      '  font-size: 22px;',
      '  text-align: center;',
      '  background-color: #ccc;',
      '  color: #000;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > h2 + ul > li:first-child {',
      '  margin-top: 0;',
      '  border-top-style: none;',
      '  padding-top: 0;',
      '}',

      // --------------------------------------------------- CSS: streams

      'div.' + constants.dom_classes.div_streams + ' > ul {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 0;',
      '  padding-left: 1em;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li {',
      '  list-style: none;',
      '  margin-top: 0.5em;',
      '  border-top: 1px solid #999;',
      '  padding-top: 0.5em;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > table {',
      '  min-height: 70px;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > table td:first-child {',
      '  font-style: italic;',
      '  padding-right: 1em;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > table td > a {',
      '  display: inline-block;',
      '  margin: 0;',
      '  color: blue;',
      '  text-decoration: none;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > blockquote {',
      '  display: block;',
      '  background-color: #eee;',
      '  padding: 0.5em 1em;',
      '  margin: 0;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > button {',
      '  margin: 0.75em 0;',
      '}',

      'div.' + constants.dom_classes.div_streams + ' > ul > li > div.' + constants.dom_classes.div_webcast_icons + ' {',
      '}',

      // --------------------------------------------------- CSS: EPG data (links to tools on Webcast Reloaded website)

      'div.' + constants.dom_classes.div_webcast_icons + ' {',
      '  display: block;',
      '  position: relative;',
      '  z-index: 1;',
      '  float: right;',
      '  margin: 0.5em;',
      '  width: 60px;',
      '  height: 60px;',
      '  max-height: 60px;',
      '  vertical-align: top;',
      '  background-color: #d7ecf5;',
      '  border: 1px solid #000;',
      '  border-radius: 14px;',
      '}',

      'div.' + constants.dom_classes.div_webcast_icons + ' > a.chromecast,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.chromecast > img,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay > img,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.proxy,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.proxy > img,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.video-link,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.video-link > img {',
      '  display: block;',
      '  width: 25px;',
      '  height: 25px;',
      '}',

      'div.' + constants.dom_classes.div_webcast_icons + ' > a.chromecast,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.proxy,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.video-link {',
      '  position: absolute;',
      '  z-index: 1;',
      '  text-decoration: none;',
      '}',

      'div.' + constants.dom_classes.div_webcast_icons + ' > a.chromecast,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay {',
      '  top: 0;',
      '}',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.proxy,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.video-link {',
      '  bottom: 0;',
      '}',

      'div.' + constants.dom_classes.div_webcast_icons + ' > a.chromecast,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.proxy {',
      '  left: 0;',
      '}',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay,',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.video-link {',
      '  right: 0;',
      '}',
      'div.' + constants.dom_classes.div_webcast_icons + ' > a.airplay + a.video-link {',
      '  right: 17px; /* (60 - 25)/2 to center when there is no proxy icon */',
      '}',

      '</style>'
    ],
    "body": [
      '<div class="' + constants.dom_classes.div_streams + '"></div>'
    ]
  }

  head.innerHTML = '' + html.head.join("\n")
  body.innerHTML = '' + html.body.join("\n")
}

// ------------------------------------- DOM: dynamic elements - common

var make_element = function(elementName, html) {
  var el = unsafeWindow.document.createElement(elementName)

  if (html)
    el.innerHTML = html

  return el
}

var make_span = function(text) {return make_element('span', text)}
var make_h4   = function(text) {return make_element('h4',   text)}

// ------------------------------------- DOM: dynamic elements - streams

var make_webcast_reloaded_div = function(video_url, caption_url, referer_url) {
  var webcast_reloaded_urls = {
//  "index":             get_webcast_reloaded_url(                  video_url, caption_url, referer_url),
    "chromecast_sender": get_webcast_reloaded_url_chromecast_sender(video_url, caption_url, referer_url),
    "airplay_sender":    get_webcast_reloaded_url_airplay_sender(   video_url, caption_url, referer_url),
    "proxy":             get_webcast_reloaded_url_proxy(            video_url, caption_url, referer_url)
  }

  var div = make_element('div')

  var html = [
    '<a target="_blank" class="chromecast" href="' + webcast_reloaded_urls.chromecast_sender + '" title="Chromecast Sender"><img src="'       + constants.img_urls.base_webcast_reloaded_icons + 'chromecast.png"></a>',
    '<a target="_blank" class="airplay" href="'    + webcast_reloaded_urls.airplay_sender    + '" title="ExoAirPlayer Sender"><img src="'     + constants.img_urls.base_webcast_reloaded_icons + 'airplay.png"></a>',
    '<a target="_blank" class="proxy" href="'      + webcast_reloaded_urls.proxy             + '" title="HLS-Proxy Configuration"><img src="' + constants.img_urls.base_webcast_reloaded_icons + 'proxy.png"></a>',
    '<a target="_blank" class="video-link" href="' + video_url                                 + '" title="direct link to video"><img src="'    + constants.img_urls.base_webcast_reloaded_icons + 'video_link.png"></a>'
  ]

  div.setAttribute('class', constants.dom_classes.div_webcast_icons)
  div.innerHTML = html.join("\n")

  return div
}

var insert_webcast_reloaded_div = function(block_element, video_url, caption_url, referer_url) {
  var webcast_reloaded_div = make_webcast_reloaded_div(video_url, caption_url, referer_url)

  if (block_element.childNodes.length)
    block_element.insertBefore(webcast_reloaded_div, block_element.childNodes[0])
  else
    block_element.appendChild(webcast_reloaded_div)
}

var download_video = function(stream_index, block_element, old_button) {
  var callback = function(video_url, video_type, caption_url) {
    if (video_url) {
      insert_webcast_reloaded_div(block_element, video_url, caption_url)
      add_start_video_button(video_url, video_type, caption_url, block_element, old_button)
    }
    else {
      old_button.innerHTML = strings.button_unavailable_video
      old_button.disabled  = true
    }
  }

  download_video_data(callback, stream_index)
}

// -------------------------------------

var onclick_start_video_button = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=true;

  var button      = event.target
  var video_url   = button.getAttribute('x-video-url')
  var video_type  = button.getAttribute('x-video-type')
  var caption_url = button.getAttribute('x-caption-url')

  if (video_url)
    process_video_url(video_url, video_type, caption_url)
}

var make_start_video_button = function(video_url, video_type, caption_url) {
  var button = make_element('button')

  button.setAttribute('x-video-url',   video_url   || '')
  button.setAttribute('x-video-type',  video_type  || '')
  button.setAttribute('x-caption-url', caption_url || '')
  button.innerHTML = strings.button_start_video
  button.addEventListener("click", onclick_start_video_button)

  return button
}

var add_start_video_button = function(video_url, video_type, caption_url, block_element, old_button) {
  var new_button = make_start_video_button(video_url, video_type, caption_url)

  if (old_button)
    old_button.parentNode.replaceChild(new_button, old_button)
  else
    block_element.appendChild(new_button)
}

// -------------------------------------

var make_stream_listitem_html = function(stream_index) {
  var stream = state.streams[stream_index]
  var name = stream.name || stream.standardName || stream.barName

  if (stream.filebitrate)
    name += ' @ ' + stream.filebitrate + ' bps'

  var tr = []

  var append_tr = function(td, colspan) {
    if (Array.isArray(td))
      tr.push('<tr><td>' + td.join('</td><td>') + '</td></tr>')
    else if ((typeof colspan === 'number') && (colspan > 1))
      tr.push('<tr><td colspan="' + colspan + '">' + td + '</td></tr>')
    else
      tr.push('<tr><td>' + td + '</td></tr>')
  }

  if (name)
    append_tr([strings.stream_labels.title, name])

  var html = ['<table>' + tr.join("\n") + '</table>']

  return '<li x-stream-index="' + stream_index + '">' + html.join("\n") + '</li>'
}

// -------------------------------------

var onclick_download_show_video_button = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=true;

  var button, stream_index, streams_div, stream_item

  button = event.target

  stream_index = button.getAttribute('x-stream-index')
  if (!stream_index) return

  streams_div = unsafeWindow.document.querySelector('div.' + constants.dom_classes.div_streams)
  if (!streams_div) return

  stream_item = streams_div.querySelector('li[x-stream-index="' + stream_index + '"]')
  if (!stream_item) return

  download_video(stream_index, /* block_element= */ stream_item, /* old_button= */ button)
}

var make_download_show_video_button = function(stream_index) {
  var button = make_element('button')

  button.setAttribute('x-stream-index', stream_index)
  button.innerHTML = strings.button_download_video
  button.addEventListener("click", onclick_download_show_video_button)

  return button
}

var add_stream_div_buttons = function(streams_div) {
  var stream_items = streams_div.querySelectorAll('li[x-stream-index]')
  var stream_item, stream_index, button

  for (var i=0; i < stream_items.length; i++) {
    stream_item = stream_items[i]

    stream_index = stream_item.getAttribute('x-stream-index')
    if (!stream_index) continue

    button = make_download_show_video_button(stream_index)
    stream_item.appendChild(button)
  }
}

// -------------------------------------

var display_streams = function() {
  var streams_div, html

  reinitialize_dom()

  streams_div = unsafeWindow.document.querySelector('div.' + constants.dom_classes.div_streams)
  if (!streams_div) return

  html = []
  if (state.info.series.title && state.info.series.id) {
    html.push('<h2>Series: <a href="/h/' + state.info.series.id + '.html?lang=en">' + state.info.series.title + '</a></h2>')
  }
  if (state.info.episode.title) {
    html.push('<h2>Episode: ' + state.info.episode.title + '</h2>')
  }
  html.push('<ul>')
  for (var i=0; i < state.streams.length; i++) {
    html.push(make_stream_listitem_html(i))
  }
  html.push('</ul>')
  streams_div.innerHTML = html.join("\n")

  add_stream_div_buttons(streams_div)
}

// ----------------------------------------------------------------------------- bootstrap

var configure_WM_useragent = function() {
  // WebMonkey API is required
  if ((typeof GM_getUserAgent !== 'function') || (typeof GM_setUserAgent !== 'function'))
    return

  var initial_useragent = GM_getUserAgent()

  if (user_options.developer.debug)
    console.log('user-agent:', initial_useragent)

  if (initial_useragent === user_options.webmonkey.firefox_useragent)
    return

  GM_setUserAgent(user_options.webmonkey.firefox_useragent)
}

var init = function() {
  configure_WM_useragent()

  var video_id_regex = /^https?:\/\/(?:[^\.]+\.)*mgtv\.com\/[vb]\/(?:[^\/]+\/)*(\d+)\.html(?:[\?#].*)?$/
  var match = video_id_regex.exec(unsafeWindow.location.href)
  if (!match) return
  reset_dom()

  state.video_id = match[1]
  encode_tk2()

  download_api_data(function(){
    download_stream_data(function(){
      // only called when automatic redirect is disabled
      display_streams()
      download_caption_languages_data(download_caption_data)
    })
  })
}

if (user_options.developer.debug)
  debugger;

init()
