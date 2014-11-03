(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Authentication Module
 *
 */

// Browserify exports and dependencies
module.exports = AuthProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');
var crypto = require('crypto-js/hmac-sha1');

function AuthProxy(service) {
  this.service = service;
}

AuthProxy.prototype.createSession = function(params, callback) {
  var _this = this, message;

  if (typeof params === 'function' && typeof callback === 'undefined') {
    callback = params;
    params = {};
  }

  // Signature of message with SHA-1 using secret key
  message = generateAuthMsg(params);
  message.signature = signMessage(message, config.creds.authSecret);
  
  if (config.debug) { console.log('AuthProxy.createSession', message); }
  this.service.ajax({url: Utils.getUrl(config.urls.session), type: 'POST', data: message},
                    function(err, res) {
                      if (err) {
                        callback(err, null);
                      } else {
                        _this.service.setSession(res.session);
                        callback(null, res.session);
                      }
                    });
};

AuthProxy.prototype.destroySession = function(callback) {
  var _this = this;
  if (config.debug) { console.log('AuthProxy.destroySession'); }
  this.service.ajax({url: Utils.getUrl(config.urls.session), type: 'DELETE', dataType: 'text'},
                    function(err, res) {
                      if (err) {
                        callback(err, null);
                      } else {
                        _this.service.setSession(null);
                        callback(null, res);
                      }
                    });
};

AuthProxy.prototype.login = function(params, callback) {
  if (config.debug) { console.log('AuthProxy.login', params); }
  this.service.ajax({url: Utils.getUrl(config.urls.login), type: 'POST', data: params},
                    function(err, res) {
                      if (err) { callback(err, null); }
                      else { callback(null, res.user); }
                    });
};

AuthProxy.prototype.logout = function(callback) {
  if (config.debug) { console.log('AuthProxy.logout'); }
  this.service.ajax({url: Utils.getUrl(config.urls.login), type: 'DELETE', dataType:'text'}, callback);
};


/* Private
---------------------------------------------------------------------- */
function generateAuthMsg(params) {
  var message = {
    application_id: config.creds.appId,
    auth_key: config.creds.authKey,
    nonce: Utils.randomNonce(),
    timestamp: Utils.unixTime()
  };
  
  // With user authorization
  if (params.login && params.password) {
    message.user = {login: params.login, password: params.password};
  } else if (params.email && params.password) {
    message.user = {email: params.email, password: params.password};
  } else if (params.provider) {
    // Via social networking provider (e.g. facebook, twitter etc.)
    message.provider = params.provider;
    if (params.scope) {
      message.scope = params.scope;
    }
    if (params.keys && params.keys.token) {
      message.keys = {token: params.keys.token};
    }
    if (params.keys && params.keys.secret) {
      messages.keys.secret = params.keys.secret;
    }
  }
  
  return message;
}

function signMessage(message, secret) {
  var sessionMsg = Object.keys(message).map(function(val) {
    if (typeof message[val] === 'object') {
      return Object.keys(message[val]).map(function(val1) {
        return val + '[' + val1 + ']=' + message[val][val1];
      }).sort().join('&');
    } else {
      return val + '=' + message[val];
    }
  }).sort().join('&');
  
  return crypto(sessionMsg, secret).toString();
}

},{"../qbConfig":8,"../qbUtils":10,"crypto-js/hmac-sha1":13}],2:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Chat 2.0 Module
 *
 */

/*
 * User's callbacks (listener-functions):
 * - onMessageListener
 * - onContactListListener
 * - onSubscribeListener
 * - onConfirmSubscribeListener
 * - onRejectSubscribeListener
 * - onDisconnectingListener
 */
 
var inBrowser = typeof window !== "undefined";

// Browserify exports and dependencies
//require('../../lib/strophe/strophe.min');
var config = require('../qbConfig');
var Utils = require('../qbUtils');
module.exports = ChatProxy;

var dialogUrl = config.urls.chat + '/Dialog';
var messageUrl = config.urls.chat + '/Message';

var mutualSubscriptions = {};

if(inBrowser) {
// create Strophe Connection object
  var protocol = config.chatProtocol.active === 1 ? config.chatProtocol.bosh : config.chatProtocol.websocket;
  var connection = new Strophe.Connection(protocol);
  if (config.debug) {
    if (config.chatProtocol.active === 1) {
      connection.xmlInput = function(data) { if (typeof data.children !== 'undefined') data.children[0] && console.log('[QBChat RECV]:', data.children[0]); };
      connection.xmlOutput = function(data) { if (typeof data.children !== 'undefined') data.children[0] && console.log('[QBChat SENT]:', data.children[0]); };
    } else {
      connection.xmlInput = function(data) { console.log('[QBChat RECV]:', data); };
      connection.xmlOutput = function(data) { console.log('[QBChat SENT]:', data); };
    }
  }
}

function ChatProxy(service) {
  var self = this;

  this.service = service;
  if(inBrowser) {
    this.roster = new RosterProxy(service);
    this.muc = new MucProxy(service); }
  this.dialog = new DialogProxy(service);
  this.message = new MessageProxy(service);
  this.helpers = new Helpers;

  // stanza callbacks (Message, Presence, IQ)

  this._onMessage = function(stanza) {
    var from = stanza.getAttribute('from'),
        type = stanza.getAttribute('type'),
        body = stanza.querySelector('body'),
        invite = stanza.querySelector('invite'),
        extraParams = stanza.querySelector('extraParams'),        
        delay = type === 'groupchat' && stanza.querySelector('delay'),
        userId = type === 'groupchat' ? self.helpers.getIdFromResource(from) : self.helpers.getIdFromNode(from),
        message, extension, attachments, attach, attributes;

    if (invite) return true;

    // custom parameters
    if (extraParams) {
      extension = {};
      attachments = [];
      for (var i = 0, len = extraParams.children.length; i < len; i++) {
        if (extraParams.children[i].tagName === 'attachment') {
          
          // attachments
          attach = {};
          attributes = extraParams.children[i].attributes;
          for (var j = 0, len2 = attributes.length; j < len2; j++) {
            if (attributes[j].name === 'id' || attributes[j].name === 'size')
              attach[attributes[j].name] = parseInt(attributes[j].value);
            else
              attach[attributes[j].name] = attributes[j].value;
          }
          attachments.push(attach);

        } else {
          extension[extraParams.children[i].tagName] = extraParams.children[i].textContent;
        }
      }

      if (attachments.length > 0)
        extension.attachments = attachments;
    }

    message = {
      type: type,
      body: (body && body.textContent) || null,
      extension: extension || null
    };

    // !delay - this needed to don't duplicate messages from chat 2.0 API history
    // with typical XMPP behavior of history messages in group chat
    if (typeof self.onMessageListener === 'function' && !delay)
      self.onMessageListener(userId, message);

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onPresence = function(stanza) {
    var from = stanza.getAttribute('from'),
        type = stanza.getAttribute('type'),
        userId = self.helpers.getIdFromNode(from);

    if (!type) {
      if (typeof self.onContactListListener === 'function' && mutualSubscriptions[userId])
        self.onContactListListener(userId, type);
    } else {

      // subscriptions callbacks
      switch (type) {
      case 'subscribe':
        if (mutualSubscriptions[userId]) {
          self.roster._sendSubscriptionPresence({
            jid: from,
            type: 'subscribed'
          });
        } else {
          if (typeof self.onSubscribeListener === 'function')
            self.onSubscribeListener(userId);
        }
        break;
      case 'subscribed':
        if (typeof self.onConfirmSubscribeListener === 'function')
          self.onConfirmSubscribeListener(userId);
        break;
      case 'unsubscribed':
        delete mutualSubscriptions[userId];
        if (typeof self.onRejectSubscribeListener === 'function')
          self.onRejectSubscribeListener(userId);
        break;
      case 'unsubscribe':
        delete mutualSubscriptions[userId];
        if (typeof self.onRejectSubscribeListener === 'function')
          self.onRejectSubscribeListener(userId);
        break;
      case 'unavailable':
        if (typeof self.onContactListListener === 'function' && mutualSubscriptions[userId])
          self.onContactListListener(userId, type);
        break;
      }

    }

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onIQ = function(stanza) {

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };
}

/* Chat module: Core
---------------------------------------------------------------------- */
ChatProxy.prototype._autoSendPresence = function() {
  connection.send($pres().tree());
  // we must return true to keep the handler alive
  // returning false would remove it after it finishes
  return true;
};

ChatProxy.prototype.connect = function(params, callback) {
  if (config.debug) { console.log('ChatProxy.connect', params); }
  var self = this, err;

  connection.connect(params.jid, params.password, function(status) {
    switch (status) {
    case Strophe.Status.ERROR:
      err = getError(422, 'Status.ERROR - An error has occurred');
      callback(err, null);
      break;
    case Strophe.Status.CONNECTING:
      trace('Status.CONNECTING');
      trace('Chat Protocol - ' + (config.chatProtocol.active === 1 ? 'BOSH' : 'WebSocket'));
      break;
    case Strophe.Status.CONNFAIL:
      err = getError(422, 'Status.CONNFAIL - The connection attempt failed');
      callback(err, null);
      break;
    case Strophe.Status.AUTHENTICATING:
      trace('Status.AUTHENTICATING');
      break;
    case Strophe.Status.AUTHFAIL:
      err = getError(401, 'Status.AUTHFAIL - The authentication attempt failed');
      callback(err, null);
      break;
    case Strophe.Status.CONNECTED:
      trace('Status.CONNECTED at ' + getLocalTime());

      connection.addHandler(self._onMessage, null, 'message');
      connection.addHandler(self._onPresence, null, 'presence');
      connection.addHandler(self._onIQ, null, 'iq');

      // get the roster
      self.roster.get(function(contacts) {

        // chat server will close your connection if you are not active in chat during one minute
        // initial presence and an automatic reminder of it each 55 seconds
        connection.send($pres().tree());
        connection.addTimedHandler(55 * 1000, self._autoSendPresence);

        callback(null, contacts);
      });

      break;
    case Strophe.Status.DISCONNECTING:
      trace('Status.DISCONNECTING');
      break;
    case Strophe.Status.DISCONNECTED:
      trace('Status.DISCONNECTED at ' + getLocalTime());

      if (typeof self.onDisconnectingListener === 'function')
        self.onDisconnectingListener();

      connection.reset();
      break;
    case Strophe.Status.ATTACHED:
      trace('Status.ATTACHED');
      break;
    }
  });
};

ChatProxy.prototype.send = function(jid, message) {
  var msg = $msg({
    from: connection.jid,
    to: jid,
    type: message.type,
    id: message.id || connection.getUniqueId()
  });
  
  if (message.body) {
    msg.c('body', {
      xmlns: Strophe.NS.CLIENT
    }).t(message.body).up();
  }
  
  // custom parameters
  if (message.extension) {
    msg.c('extraParams', {
      xmlns: Strophe.NS.CLIENT
    });
    
    Object.keys(message.extension).forEach(function(field) {
      if (field === 'attachments') {

        // attachments
        message.extension[field].forEach(function(attach) {
          msg.c('attachment', attach).up();
        });

      } else {
        msg.c(field).t(message.extension[field]).up();
      }
    });
  }
  
  connection.send(msg);
};

// helper function for ChatProxy.send()
ChatProxy.prototype.sendPres = function(type) {
  connection.send($pres({ 
    from: connection.jid,
    type: type
  }));
};

ChatProxy.prototype.disconnect = function() {
  connection.flush();
  connection.disconnect();
};

ChatProxy.prototype.addListener = function(params, callback) {
  return connection.addHandler(handler, null, params.name || null, params.type || null, params.id || null, params.from || null);

  function handler() {
    callback();
    // if 'false' - a handler will be performed only once
    return params.live !== false;
  }
};

ChatProxy.prototype.deleteListener = function(ref) {
  connection.deleteHandler(ref);
};

/* Chat module: Roster
 *
 * Integration of Roster Items and Presence Subscriptions
 * http://xmpp.org/rfcs/rfc3921.html#int
 * default - Mutual Subscription
 *
---------------------------------------------------------------------- */
function RosterProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

RosterProxy.prototype.get = function(callback) {
  var iq, self = this,
      items, userId, contacts = {};

  iq = $iq({
    from: connection.jid,
    type: 'get',
    id: connection.getUniqueId('roster')
  }).c('query', {
    xmlns: Strophe.NS.ROSTER
  });

  connection.sendIQ(iq, function(stanza) {
    items = stanza.getElementsByTagName('item');
    for (var i = 0, len = items.length; i < len; i++) {
      userId = self.helpers.getIdFromNode(items[i].getAttribute('jid')).toString();
      contacts[userId] = {
        subscription: items[i].getAttribute('subscription'),
        ask: items[i].getAttribute('ask') || null
      };

      // mutual subscription
      if (items[i].getAttribute('ask') || items[i].getAttribute('subscription') !== 'none')
        mutualSubscriptions[userId] = true;
    }
    callback(contacts);
  });
};

RosterProxy.prototype.add = function(jid) {
  this._sendRosterRequest({
    jid: jid,
    type: 'subscribe'
  });
};

RosterProxy.prototype.confirm = function(jid) {
  this._sendRosterRequest({
    jid: jid,
    type: 'subscribed'
  });
};

RosterProxy.prototype.reject = function(jid) {
  this._sendRosterRequest({
    jid: jid,
    type: 'unsubscribed'
  });
};

RosterProxy.prototype.remove = function(jid) {
  this._sendSubscriptionPresence({
    jid: jid,
    type: 'unsubscribe'
  });
  this._sendSubscriptionPresence({
    jid: jid,
    type: 'unsubscribed'
  });
  this._sendRosterRequest({
    jid: jid,
    subscription: 'remove',
    type: 'unsubscribe'
  });
};

RosterProxy.prototype._sendRosterRequest = function(params) {
  var iq, attr = {},
      userId, self = this;

  iq = $iq({
    from: connection.jid,
    type: 'set',
    id: connection.getUniqueId('roster')
  }).c('query', {
    xmlns: Strophe.NS.ROSTER
  });

  if (params.jid)
    attr.jid = params.jid;
  if (params.subscription)
    attr.subscription = params.subscription;

  iq.c('item', attr);
  userId = self.helpers.getIdFromNode(params.jid).toString();

  connection.sendIQ(iq, function() {

    // subscriptions requests
    switch (params.type) {
    case 'subscribe':
      self._sendSubscriptionPresence(params);
      mutualSubscriptions[userId] = true;
      break;
    case 'subscribed':
      self._sendSubscriptionPresence(params);
      mutualSubscriptions[userId] = true;

      params.type = 'subscribe';
      self._sendSubscriptionPresence(params);
      break;
    case 'unsubscribed':
      self._sendSubscriptionPresence(params);
      break;
    case 'unsubscribe':
      delete mutualSubscriptions[userId];
      params.type = 'unavailable';
      self._sendSubscriptionPresence(params);
      break;
    }

  });
};

RosterProxy.prototype._sendSubscriptionPresence = function(params) {
  var pres, self = this;

  pres = $pres({
    to: params.jid,
    type: params.type
  });

  connection.send(pres);
};

/* Chat module: Group Chat
 *
 * Multi-User Chat
 * http://xmpp.org/extensions/xep-0045.html
 *
---------------------------------------------------------------------- */
function MucProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MucProxy.prototype.join = function(jid, callback) {
  var pres, self = this,
      id = connection.getUniqueId('join');

  pres = $pres({
    from: connection.jid,
    to: self.helpers.getRoomJid(jid),
    id: id
  }).c("x", {
    xmlns: Strophe.NS.MUC
  });

  connection.addHandler(callback, null, 'presence', null, id);
  connection.send(pres);
};

MucProxy.prototype.leave = function(jid, callback) {
  var pres, self = this,
      roomJid = self.helpers.getRoomJid(jid);

  pres = $pres({
    from: connection.jid,
    to: roomJid,
    type: 'unavailable'
  });

  connection.addHandler(callback, null, 'presence', 'unavailable', null, roomJid);
  connection.send(pres);
};

/* Chat module: History
---------------------------------------------------------------------- */

// Dialogs

function DialogProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

DialogProxy.prototype.list = function(params, callback) {
  if (typeof params === 'function' && typeof callback === 'undefined') {
    callback = params;
    params = {};
  }

  if (config.debug) { console.log('DialogProxy.list', params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl), data: params}, callback);
};

DialogProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('DialogProxy.create', params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl), type: 'POST', data: params}, callback);
};

DialogProxy.prototype.update = function(id, params, callback) {
  if (config.debug) { console.log('DialogProxy.update', id, params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl, id), type: 'PUT', data: params}, callback);
};

// Messages

function MessageProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MessageProxy.prototype.list = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.list', params); }
  this.service.ajax({url: Utils.getUrl(messageUrl), data: params}, callback);
};

MessageProxy.prototype.update = function(id, params, callback) {
  if (config.debug) { console.log('MessageProxy.update', id, params); }
  this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'PUT', data: params}, callback);
};

MessageProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.delete', id); }
  this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'DELETE', dataType: 'text'}, callback);
};

/* Helpers
---------------------------------------------------------------------- */
function Helpers() {}

Helpers.prototype = {

  getUserJid: function(id, appId) {
    return id + '-' + appId + '@' + config.endpoints.chat;
  },

  getIdFromNode: function(jid) {
    return parseInt(Strophe.getNodeFromJid(jid).split('-')[0]);
  },

  getRoomJid: function(jid) {
    return jid + '/' + this.getIdFromNode(connection.jid);
  },  

  getIdFromResource: function(jid) {
    return parseInt(Strophe.getResourceFromJid(jid));
  },

  getUniqueId: function(suffix) {
    return connection.getUniqueId(suffix);
  }

};

/* Private
---------------------------------------------------------------------- */
function trace(text) {
  // if (config.debug) {
    console.log('[QBChat]:', text);
  // }
}

function getError(code, detail) {
  var errorMsg = {
    code: code,
    status: 'error',
    message: code === 401 ? 'Unauthorized' : 'Unprocessable Entity',
    detail: detail
  };

  trace(detail);
  return errorMsg;
}

function getLocalTime() {
  return (new Date).toTimeString().split(' ')[0];
}

},{"../qbConfig":8,"../qbUtils":10}],3:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Content module
 *
 * For an overview of this module and what it can be used for
 * see http://quickblox.com/modules/content
 *
 * The API itself is described at http://quickblox.com/developers/Content
 *
 */

// Browserify exports and dependencies
module.exports = ContentProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');

var taggedForUserUrl = config.urls.blobs + '/tagged';

function ContentProxy(service) {
  this.service = service;
}

ContentProxy.prototype.create = function(params, callback){
 if (config.debug) { console.log('ContentProxy.create', params);}
  this.service.ajax({url: Utils.getUrl(config.urls.blobs), data: {blob:params}, type: 'POST'}, function(err,result){
    if (err){ callback(err, null); }
    else { callback (err, result.blob); }
  });
};

ContentProxy.prototype.list = function(params, callback){
  if (typeof params === 'function' && typeof callback ==='undefined') {
    callback = params;
    params = null;
  }
  this.service.ajax({url: Utils.getUrl(config.urls.blobs)}, function(err,result){
    if (err){ callback(err, null); }
    else { callback (err, result); }
  });
};

ContentProxy.prototype.delete = function(id, callback){
  this.service.ajax({url: Utils.getUrl(config.urls.blobs, id), type: 'DELETE', dataType: 'text'}, function(err, result) {
    if (err) { callback(err,null); }
    else { callback(null, true); }
  });
};

ContentProxy.prototype.createAndUpload = function(params, callback){
  var createParams= {}, file, name, type, size, fileId, _this = this;
  if (config.debug) { console.log('ContentProxy.createAndUpload', params);}
  file = params.file;
  name = params.name || file.name;
  type = params.type || file.type;
  size = file.size;
  createParams.name = name;
  createParams.content_type = type;
  if (params.public) { createParams.public = params.public; }
  if (params.tag_list) { createParams.tag_list = params.tag_list; }
  this.create(createParams, function(err,createResult){
    if (err){ callback(err, null); }
    else {
      var uri = parseUri(createResult.blob_object_access.params), uploadParams = { url: uri.protocol + '://' + uri.host }, data = new FormData();
      fileId = createResult.id;
      
      Object.keys(uri.queryKey).forEach(function(val) {
        data.append(val, decodeURIComponent(uri.queryKey[val]));
      });
      data.append('file', file, createResult.name);
      
      uploadParams.data = data;
      _this.upload(uploadParams, function(err, result) {
        if (err) { callback(err, null); }
        else {
          createResult.path = result.Location;
          _this.markUploaded({id: fileId, size: size}, function(err, result){
            if (err) { callback(err, null);}
            else {
              callback(null, createResult);
            }
          });
        }
      });
    }
  });
};


ContentProxy.prototype.upload = function(params, callback){
  this.service.ajax({url: params.url, data: params.data, dataType: 'xml',
                     contentType: false, processData: false, type: 'POST'}, function(err,xmlDoc){
    if (err) { callback (err, null); }
    else {
      // AWS S3 doesn't respond with a JSON structure
      // so parse the xml and return a JSON structure ourselves
      var result = {}, rootElement = xmlDoc.documentElement, children = rootElement.childNodes, i, m;
      for (i = 0, m = children.length; i < m ; i++){
        result[children[i].nodeName] = children[i].childNodes[0].nodeValue;
      } 
      if (config.debug) { console.log('result', result); }
      callback (null, result);
    }
  });
};

ContentProxy.prototype.taggedForCurrentUser = function(callback) {
  this.service.ajax({url: Utils.getUrl(taggedForUserUrl)}, function(err, result) {
    if (err) { callback(err, null); }
    else { callback(null, result); }
  });
};

ContentProxy.prototype.markUploaded = function (params, callback) {
  this.service.ajax({url: Utils.getUrl(config.urls.blobs, params.id + '/complete'), type: 'PUT', data: {size: params.size}, dataType: 'text' }, function(err, res){
    if (err) { callback (err, null); }
    else { callback (null, res); }
  });
};

ContentProxy.prototype.getInfo = function (id, callback) {
  this.service.ajax({url: Utils.getUrl(config.urls.blobs, id)}, function (err, res) {
    if (err) { callback (err, null); }
    else { callback (null, res); }
  });
};

ContentProxy.prototype.getFile = function (uid, callback) {
 this.service.ajax({url: Utils.getUrl(config.urls.blobs, uid)}, function (err, res) {
    if (err) { callback (err, null); }
    else { callback (null, res); }
  });
};

ContentProxy.prototype.getFileUrl = function (id, callback) {
 this.service.ajax({url: Utils.getUrl(config.urls.blobs, id + '/getblobobjectbyid'), type: 'POST'}, function (err, res) {
    if (err) { callback (err, null); }
    else { callback (null, res.blob_object_access.params); }
  });
};

ContentProxy.prototype.update = function (params, callback) {
  var data = {};
  data.blob = {};
  if (typeof params.name !== 'undefined') { data.blob.name = params.name; }
  this.service.ajax({url: Utils.getUrl(config.urls.blobs, params.id), data: data}, function(err, res) {
    if (err) { callback (err, null); }
    else { callback (null, res); } 
  });
}


// parseUri 1.2.2
// (c) Steven Levithan <stevenlevithan.com>
// MIT License
// http://blog.stevenlevithan.com/archives/parseuri

function parseUri (str) {
  var o   = parseUri.options,
    m   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
    uri = {},
    i   = 14;

  while (i--) {uri[o.key[i]] = m[i] || "";}

  uri[o.q.name] = {};
  uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
    if ($1) {uri[o.q.name][$1] = $2;}
  });

  return uri;
}

parseUri.options = {
  strictMode: false,
  key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
  q:   {
    name:   "queryKey",
    parser: /(?:^|&)([^&=]*)=?([^&]*)/g
  },
  parser: {
    strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
    loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
  }
};

},{"../qbConfig":8,"../qbUtils":10}],4:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Custom Objects module
 *
 */

// Browserify exports and dependencies
module.exports = DataProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');

function DataProxy(service){
  this.service = service;
  if (config.debug) { console.log("LocationProxy", service); }
}

DataProxy.prototype.create = function(className, data, callback) {
  if (config.debug) { console.log('DataProxy.create', className, data);}
  this.service.ajax({url: Utils.getUrl(config.urls.data, className), data: data, type: 'POST'}, function(err,res){
    if (err){ callback(err, null); }
    else { callback (err, res); }
  });
};

DataProxy.prototype.list = function(className, filters, callback) {
  // make filters an optional parameter
  if (typeof callback === 'undefined' && typeof filters === 'function') {
    callback = filters;
    filters = null;
  }
  if (config.debug) { console.log('DataProxy.list', className, filters);}
  this.service.ajax({url: Utils.getUrl(config.urls.data, className), data: filters}, function(err,result){
    if (err){ callback(err, null); }
    else { callback (err, result); }
  });
};

DataProxy.prototype.update = function(className, data, callback) {
  if (config.debug) { console.log('DataProxy.update', className, data);}
  this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + data._id), data: data, type: 'PUT'}, function(err,result){
    if (err){ callback(err, null); }
    else { callback (err, result); }
  });
};

DataProxy.prototype.delete = function(className, id, callback) {
  if (config.debug) { console.log('DataProxy.delete', className, id);}
  this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + id), type: 'DELETE', dataType: 'text'},
                    function(err,result){
                      if (err){ callback(err, null); }
                      else { callback (err, true); }
                    });
};

DataProxy.prototype.uploadFile = function(className, params, callback) {
  var formData;
  if (config.debug) { console.log('DataProxy.uploadFile', className, params);}
  formData = new FormData();
  formData.append('field_name', params.field_name);
  formData.append('file', params.file);
  this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: formData,
                    contentType: false, processData: false, type:'POST'}, function(err, result){
                      if (err) { callback(err, null);}
                      else { callback (err, result); }
                    });
};

DataProxy.prototype.updateFile = function(className, params, callback) {
  var formData;
  if (config.debug) { console.log('DataProxy.updateFile', className, params);}
  formData = new FormData();
  formData.append('field_name', params.field_name);
  formData.append('file', params.file);
  this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: formData,
                    contentType: false, processData: false, type: 'POST'}, function(err, result) {
                      if (err) { callback (err, null); }
                      else { callback (err, result); }
                    });
};

DataProxy.prototype.downloadFile = function(className, params, callback) {
  if (config.debug) { console.log('DataProxy.downloadFile', className, params); }
  var result = Utils.getUrl(config.urls.data, className + '/' + params.id + '/file');
  result += '?field_name=' + params.field_name + '&token=' + this.service.getSession().token;
  callback(null, result);
};

DataProxy.prototype.deleteFile = function(className, params, callback) {
  if (config.debug) { console.log('DataProxy.deleteFile', className, params);}
  this.service.ajax({url: Utils.getUrl(config.urls.data, className + '/' + params.id + '/file'), data: {field_name: params.field_name},
                    dataType: 'text', type: 'DELETE'}, function(err, result) {
                      if (err) { callback (err, null); }
                      else { callback (err, true); }
                    });
};

},{"../qbConfig":8,"../qbUtils":10}],5:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Location module
 *
 */

// Browserify exports and dependencies
module.exports = LocationProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');

var geoFindUrl = config.urls.geodata + '/find';

function LocationProxy(service){
  this.service = service;
  this.geodata = new GeoProxy(service);
  this.places = new PlacesProxy(service);
  if (config.debug) { console.log("LocationProxy", service); }
}

function GeoProxy(service){
  this.service = service;
}

GeoProxy.prototype.create = function(params, callback){
  if (config.debug) { console.log('GeoProxy.create', {geo_data: params});}
  this.service.ajax({url: Utils.getUrl(config.urls.geodata), data: {geo_data: params}, type: 'POST'}, function(err,result){
    if (err){ callback(err, null); }
    else { callback (err, result.geo_datum); }
  });
};

GeoProxy.prototype.update = function(params, callback){
  var allowedProps = ['longitude', 'latitude', 'status'], prop, msg = {};
  for (prop in params) {
    if (params.hasOwnProperty(prop)) {
      if (allowedProps.indexOf(prop)>0) {
        msg[prop] = params[prop];
      } 
    }
  }
  if (config.debug) { console.log('GeoProxy.create', params);}
  this.service.ajax({url: Utils.getUrl(config.urls.geodata, params.id), data: {geo_data:msg}, type: 'PUT'},
                   function(err,res){
                    if (err) { callback(err,null);}
                    else { callback(err, res.geo_datum);}
                   });
};

GeoProxy.prototype.get = function(id, callback){
  if (config.debug) { console.log('GeoProxy.get', id);}
  this.service.ajax({url: Utils.getUrl(config.urls.geodata, id)}, function(err,result){
     if (err) { callback (err, null); }
     else { callback(null, result.geo_datum); }
  });
};

GeoProxy.prototype.list = function(params, callback){
  if (typeof params === 'function') {
    callback = params;
    params = undefined;
  }
  if (config.debug) { console.log('GeoProxy.find', params);}
  this.service.ajax({url: Utils.getUrl(geoFindUrl), data: params}, callback);
};

GeoProxy.prototype.delete = function(id, callback){
  if (config.debug) { console.log('GeoProxy.delete', id); }
  this.service.ajax({url: Utils.getUrl(config.urls.geodata, id), type: 'DELETE', dataType: 'text'},
                   function(err,res){
                    if (err) { callback(err, null);}
                    else { callback(null, true);}
                   });
};

GeoProxy.prototype.purge = function(days, callback){
  if (config.debug) { console.log('GeoProxy.purge', days); }
  this.service.ajax({url: Utils.getUrl(config.urls.geodata), data: {days: days}, type: 'DELETE', dataType: 'text'},
                   function(err, res){
                    if (err) { callback(err, null);}
                    else { callback(null, true);}
                   });
};

function PlacesProxy(service) {
  this.service = service;
}

PlacesProxy.prototype.list = function(params, callback){
  if (config.debug) { console.log('PlacesProxy.list', params);}
  this.service.ajax({url: Utils.getUrl(config.urls.places)}, callback);
};

PlacesProxy.prototype.create = function(params, callback){
  if (config.debug) { console.log('PlacesProxy.create', params);}
  this.service.ajax({url: Utils.getUrl(config.urls.places), data: {place:params}, type: 'POST'}, callback);
};

PlacesProxy.prototype.get = function(id, callback){
  if (config.debug) { console.log('PlacesProxy.get', id);}
  this.service.ajax({url: Utils.getUrl(config.urls.places, id)}, callback);
};

PlacesProxy.prototype.update = function(place, callback){
  if (config.debug) { console.log('PlacesProxy.update', place);}
  this.service.ajax({url: Utils.getUrl(config.urls.places, place.id), data: {place: place}, type: 'PUT'} , callback);
};

PlacesProxy.prototype.delete = function(id, callback){
  if (config.debug) { console.log('PlacesProxy.delete', id);}
  this.service.ajax({url: Utils.getUrl(config.urls.places, id), type: 'DELETE', dataType: 'text'}, callback);
};

},{"../qbConfig":8,"../qbUtils":10}],6:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Messages Module
 *
 */

// broserify export and dependencies

// Browserify exports and dependencies
module.exports = MessagesProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');

function MessagesProxy(service) {
  this.service = service;
  this.tokens = new TokensProxy(service);
  this.subscriptions = new SubscriptionsProxy(service);
  this.events = new EventsProxy(service);
}

// Push Tokens

function TokensProxy(service){
  this.service = service;
}

TokensProxy.prototype.create = function(params, callback){
  var message = {
    push_token: {
      environment: params.environment,
      client_identification_sequence: params.client_identification_sequence
    },
    device: { platform: params.platform, udid: params.udid}
  };
  if (config.debug) { console.log('TokensProxy.create', message);}
  this.service.ajax({url: Utils.getUrl(config.urls.pushtokens), type: 'POST', data: message},
                    function(err, data){
                      if (err) { callback(err, null);}
                      else { callback(null, data.push_token); }
                    });
};

TokensProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.deletePushToken', id); }
  this.service.ajax({url: Utils.getUrl(config.urls.pushtokens, id), type: 'DELETE', dataType:'text'}, 
                    function (err, res) {
                      if (err) {callback(err, null);}
                      else {callback(null, true);}
                      });
};

// Subscriptions

function SubscriptionsProxy(service){
  this.service = service;
}

SubscriptionsProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.createSubscription', params); }
  this.service.ajax({url: Utils.getUrl(config.urls.subscriptions), type: 'POST', data: params}, callback);
};

SubscriptionsProxy.prototype.list = function(callback) {
  if (config.debug) { console.log('MessageProxy.listSubscription'); }
  this.service.ajax({url: Utils.getUrl(config.urls.subscriptions)}, callback);
};

SubscriptionsProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.deleteSubscription', id); }
  this.service.ajax({url: Utils.getUrl(config.urls.subscriptions, id), type: 'DELETE', dataType:'text'}, 
                    function(err, res){
                      if (err) { callback(err, null);}
                      else { callback(null, true);}
                    });
};

// Events
function EventsProxy(service){
  this.service = service;
}

EventsProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.createEvent', params); }
  var message = {event: params};
  this.service.ajax({url: Utils.getUrl(config.urls.events), type: 'POST', data: message}, callback);
};

EventsProxy.prototype.list = function(callback) {
 if (config.debug) { console.log('MessageProxy.listEvents'); }
  this.service.ajax({url: Utils.getUrl(config.urls.events)}, callback);
};

EventsProxy.prototype.get = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.getEvents', id); }
  this.service.ajax({url: Utils.getUrl(config.urls.events, id)}, callback);
};

EventsProxy.prototype.update = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.createEvent', params); }
  var message = {event: params};
  this.service.ajax({url: Utils.getUrl(config.urls.events, params.id), type: 'PUT', data: message}, callback);
};

EventsProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.deleteEvent', id); }
  this.service.ajax({url: Utils.getUrl(config.urls.events, id), type: 'DELETE'}, callback);
};

},{"../qbConfig":8,"../qbUtils":10}],7:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Users Module
 *
 */

// Browserify exports and dependencies
module.exports = UsersProxy;
var config = require('../qbConfig');
var Utils = require('../qbUtils');

var DATE_FIELDS = ['created_at', 'updated_at', 'last_request_at'];
var NUMBER_FIELDS = ['id', 'external_user_id'];

var resetPasswordUrl = config.urls.users + '/password/reset';

function UsersProxy(service) {
  this.service = service;
}

UsersProxy.prototype.listUsers = function(params, callback) {
  var message = {}, filters = [], item;
  
  if (typeof params === 'function' && typeof callback === 'undefined') {
    callback = params;
    params = {};
  }
  
  if (params.filter) {
    if (params.filter instanceof Array) {
      params.filter.forEach(function(el) {
        item = generateFilter(el);
        filters.push(item);
      });
    } else {
      item = generateFilter(params.filter);
      filters.push(item);
    }
    message.filter = filters;
  }
  if (params.order) {
    message.order = generateOrder(params.order);
  }
  if (params.page) {
    message.page = params.page;
  }
  if (params.per_page) {
    message.per_page = params.per_page;
  }
  
  if (config.debug) { console.log('UsersProxy.listUsers', message); }
  this.service.ajax({url: Utils.getUrl(config.urls.users), data: message}, callback);
};

UsersProxy.prototype.get = function(params, callback) {
  var url;
  
  if (typeof params === 'number') {
    url = params;
    params = {};
  } else {
    if (params.login) {
      url = 'by_login';
    } else if (params.full_name) {
      url = 'by_full_name';
    } else if (params.facebook_id) {
      url = 'by_facebook_id';
    } else if (params.twitter_id) {
      url = 'by_twitter_id';
    } else if (params.email) {
      url = 'by_email';
    } else if (params.tags) {
      url = 'by_tags';
    } else if (params.external) {
      url = 'external/' + params.external;
      params = {};
    }
  }
  
  if (config.debug) { console.log('UsersProxy.get', params); }
  this.service.ajax({url: Utils.getUrl(config.urls.users, url), data: params},
                    function(err, res) {
                      if (err) { callback(err, null); }
                      else { callback(null, res.user || res); }
                    });
};

UsersProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('UsersProxy.create', params); }
  this.service.ajax({url: Utils.getUrl(config.urls.users), type: 'POST', data: {user: params}},
                    function(err, res) {
                      if (err) { callback(err, null); }
                      else { callback(null, res.user); }
                    });
};

UsersProxy.prototype.update = function(id, params, callback) {
  if (config.debug) { console.log('UsersProxy.update', id, params); }
  this.service.ajax({url: Utils.getUrl(config.urls.users, id), type: 'PUT', data: {user: params}},
                    function(err, res) {
                      if (err) { callback(err, null); }
                      else { callback(null, res.user); }
                    });
};

UsersProxy.prototype.delete = function(params, callback) {
  var url;
  
  if (typeof params === 'number') {
    url = params;
  } else {
    if (params.external) {
      url = 'external/' + params.external;
    }
  }
  
  if (config.debug) { console.log('UsersProxy.delete', url); }
  this.service.ajax({url: Utils.getUrl(config.urls.users, url), type: 'DELETE', dataType: 'text'}, callback);
};

UsersProxy.prototype.resetPassword = function(email, callback) {
  if (config.debug) { console.log('UsersProxy.resetPassword', email); }
  this.service.ajax({url: Utils.getUrl(resetPasswordUrl), data: {email: email}}, callback);
};


/* Private
---------------------------------------------------------------------- */
function generateFilter(obj) {
  var type = obj.field in DATE_FIELDS ? 'date' : typeof obj.value;
  
  if (obj.value instanceof Array) {
    if (type == 'object') {
      type = typeof obj.value[0];
    }
    obj.value = obj.value.toString();
  }
  
  return [type, obj.field, obj.param, obj.value].join(' ');
}

function generateOrder(obj) {
  var type = obj.field in DATE_FIELDS ? 'date' : obj.field in NUMBER_FIELDS ? 'number' : 'string';
  return [obj.sort, type, obj.field].join(' ');
}

},{"../qbConfig":8,"../qbUtils":10}],8:[function(require,module,exports){
/* 
 * QuickBlox JavaScript SDK
 *
 * Configuration Module
 *
 */

var config = {
  version: '1.3.1',
  creds: {
    appId: '',
    authKey: '',
    authSecret: ''
  },
  endpoints: {
    api: 'api.quickblox.com',
    chat: 'chat.quickblox.com',
    muc: 'muc.chat.quickblox.com',
    turn: 'turnserver.quickblox.com',
    s3Bucket: 'qbprod'
  },
  chatProtocol: {
    // bosh: 'http://chat.quickblox.com:8080',
    bosh: 'https://chat.quickblox.com:8081', // With SSL
    websocket: 'ws://chat.quickblox.com:5290',
    active: 1
  },
  urls: {
    session: 'session',
    login: 'login',
    users: 'users',
    chat: 'chat',
    blobs: 'blobs',
    geodata: 'geodata',
    places: 'places',
    pushtokens: 'push_tokens',
    subscriptions: 'subscriptions',
    events: 'events',
    data: 'data',
    type: '.json'
  },
  ssl: true,
  debug: false
};

config.set = function(options) {
  Object.keys(options).forEach(function(key) {
    if(key !== 'set' && config.hasOwnProperty(key)) {
      if(typeof options[key] !== 'object') {
        config[key] = options[key]
      } else {
        Object.keys(options[key]).forEach(function(nextkey) {
          if(config.hasOwnProperty(key))
            config[key][nextkey] = options[key][nextkey];
        });
      }
    }
  })
};

// Browserify exports
module.exports = config;

},{}],9:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Proxy Module
 *
 */

// Browserify exports and dependencies
module.exports = ServiceProxy;
var config = require('./qbConfig');

// For server-side applications through using npm package 'quickblox' you should include the following line
var request = require('request');

function ServiceProxy() {
  this.qbInst = {
    config: config,
    session: null
  };
  if (config.debug) { console.log("ServiceProxy", this.qbInst); }
}

ServiceProxy.prototype.setSession = function(session) {
  this.qbInst.session = session;
};

ServiceProxy.prototype.getSession = function() {
  return this.qbInst.session;
};

ServiceProxy.prototype.ajax = function(params, callback) {
  if (config.debug) { console.log('ServiceProxy', params.type || 'GET', params); }
  var _this = this;
  var ajaxCall = {
    url: params.url,
    type: params.type || 'GET',
    dataType: params.dataType || 'json',
    data: params.data || ' ',
    beforeSend: function(jqXHR, settings) {
      if (config.debug) { console.log('ServiceProxy.ajax beforeSend', jqXHR, settings); }
      if (settings.url.indexOf('://' + config.endpoints.s3Bucket) === -1) {
        console.log('setting headers on request to ' + settings.url);
        if (_this.qbInst.session && _this.qbInst.session.token) {
          jqXHR.setRequestHeader('QB-Token', _this.qbInst.session.token);
        }
      }
    },
    headers: (((settings.url.indexOf('://' + config.endpoints.s3Bucket) === -1)
                && (_this.qbInst.session && _this.qbInst.session.token)) ? { 'QB-Token' : _this.qbInst.session.token } : {}),
    success: function(data, status, jqHXR) {
      if (config.debug) { console.log('ServiceProxy.ajax success', data); }
      callback(null, data);
    },
    error: function(jqHXR, status, error) {
      if (config.debug) { console.log('ServiceProxy.ajax error', jqHXR.status, error, jqHXR.responseText); }
      var errorMsg = {
        code: jqHXR.status,
        status: status,
        message: error,
        detail: jqHXR.responseText
      };
      callback(errorMsg, null);
    }
  };
  
  // Optional - for example 'multipart/form-data' when sending a file.
  // Default is 'application/x-www-form-urlencoded; charset=UTF-8'
  if (typeof params.contentType === 'boolean' || typeof params.contentType === 'string') { ajaxCall.contentType = params.contentType; }
  if (typeof params.processData === 'boolean') { ajaxCall.processData = params.processData; }
  
  if(window && jQuery) {
    jQuery.ajax( ajaxCall );
  } else {
    request(ajaxCall, function(error, response, body) {
      if(!error) {
        ajaxCall.success(body);
      } else {
        ajaxCall.error(error, response.statusCode, body)
      }
    });
  }
};

},{"./qbConfig":8,"request":undefined}],10:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * QuickBlox Utilities
 *
 */

// Browserify exports and dependencies
var config = require('./qbConfig');

exports.randomNonce = function() {
  return ~~(Math.random() * 10000);
};

exports.unixTime = function() {
  return ~~(Date.now() / 1000);
};

exports.getUrl = function(base, id) {
  var protocol = config.ssl ? 'https://' : 'http://';
  var resource = id ? '/' + id : '';
  return protocol + config.endpoints.api + '/' + base + resource + config.urls.type;
};

},{"./qbConfig":8}],11:[function(require,module,exports){
/*
 * QuickBlox JavaScript SDK
 *
 * Main SDK Module
 *
 * Provides a window scoped variable (QB) for use in browsers.
 * Also exports QuickBlox for using with node.js, browserify, etc. 
 *
 */

// Browserify dependencies
var config = require('./qbConfig');
var Proxy = require('./qbProxy');

var Auth = require('./modules/qbAuth');
var Users = require('./modules/qbUsers');
var Chat = require('./modules/qbChat');
var Content = require('./modules/qbContent');
var Location = require('./modules/qbLocation');
var Messages = require('./modules/qbMessages');
var Data = require('./modules/qbData');

// Creating a window scoped QB instance
if (typeof window !== 'undefined' && typeof window.QB === 'undefined') {
  window.QB = new QuickBlox();
}

// Actual QuickBlox API starts here
function QuickBlox() {}

QuickBlox.prototype.init = function(appId, authKey, authSecret, debug) {
  
  if (debug && typeof debug === 'boolean') config.debug = debug;
  else if (debug && typeof debug === 'object') config.set(authKey);
  
  this.service = new Proxy();
  this.auth = new Auth(this.service);
  this.users = new Users(this.service);
  this.chat = new Chat(this.service);
  this.content = new Content(this.service);
  this.location = new Location(this.service);
  this.messages = new Messages(this.service);
  this.data = new Data(this.service);
  
  // Initialization by outside token
  if (typeof appId === 'string' && !authKey && !authSecret) {
    this.service.setSession({ token: appId });
  } else {
    config.creds.appId = appId;
    config.creds.authKey = authKey;
    config.creds.authSecret = authSecret;
  }
  if(console && config.debug) console.log('QuickBlox.init', this);
};

QuickBlox.prototype.createSession = function(params, callback) {
  this.auth.createSession(params, callback);
};

QuickBlox.prototype.destroySession = function(callback) {
  this.auth.destroySession(callback);
};

QuickBlox.prototype.login = function(params, callback) {
  this.auth.login(params, callback);
};

QuickBlox.prototype.logout = function(callback) {
  this.auth.logout(callback);
};

// Browserify exports
module.exports = new QuickBlox();
module.exports.QuickBlox = QuickBlox;

},{"./modules/qbAuth":1,"./modules/qbChat":2,"./modules/qbContent":3,"./modules/qbData":4,"./modules/qbLocation":5,"./modules/qbMessages":6,"./modules/qbUsers":7,"./qbConfig":8,"./qbProxy":9}],12:[function(require,module,exports){
(function(e,r){"object"==typeof exports?module.exports=exports=r():"function"==typeof define&&define.amd?define([],r):e.CryptoJS=r()})(this,function(){var e=e||function(e,r){var t={},i=t.lib={},n=i.Base=function(){function e(){}return{extend:function(r){e.prototype=this;var t=new e;return r&&t.mixIn(r),t.hasOwnProperty("init")||(t.init=function(){t.$super.init.apply(this,arguments)}),t.init.prototype=t,t.$super=this,t},create:function(){var e=this.extend();return e.init.apply(e,arguments),e},init:function(){},mixIn:function(e){for(var r in e)e.hasOwnProperty(r)&&(this[r]=e[r]);e.hasOwnProperty("toString")&&(this.toString=e.toString)},clone:function(){return this.init.prototype.extend(this)}}}(),o=i.WordArray=n.extend({init:function(e,t){e=this.words=e||[],this.sigBytes=t!=r?t:4*e.length},toString:function(e){return(e||s).stringify(this)},concat:function(e){var r=this.words,t=e.words,i=this.sigBytes,n=e.sigBytes;if(this.clamp(),i%4)for(var o=0;n>o;o++){var c=255&t[o>>>2]>>>24-8*(o%4);r[i+o>>>2]|=c<<24-8*((i+o)%4)}else if(t.length>65535)for(var o=0;n>o;o+=4)r[i+o>>>2]=t[o>>>2];else r.push.apply(r,t);return this.sigBytes+=n,this},clamp:function(){var r=this.words,t=this.sigBytes;r[t>>>2]&=4294967295<<32-8*(t%4),r.length=e.ceil(t/4)},clone:function(){var e=n.clone.call(this);return e.words=this.words.slice(0),e},random:function(r){for(var t=[],i=0;r>i;i+=4)t.push(0|4294967296*e.random());return new o.init(t,r)}}),c=t.enc={},s=c.Hex={stringify:function(e){for(var r=e.words,t=e.sigBytes,i=[],n=0;t>n;n++){var o=255&r[n>>>2]>>>24-8*(n%4);i.push((o>>>4).toString(16)),i.push((15&o).toString(16))}return i.join("")},parse:function(e){for(var r=e.length,t=[],i=0;r>i;i+=2)t[i>>>3]|=parseInt(e.substr(i,2),16)<<24-4*(i%8);return new o.init(t,r/2)}},u=c.Latin1={stringify:function(e){for(var r=e.words,t=e.sigBytes,i=[],n=0;t>n;n++){var o=255&r[n>>>2]>>>24-8*(n%4);i.push(String.fromCharCode(o))}return i.join("")},parse:function(e){for(var r=e.length,t=[],i=0;r>i;i++)t[i>>>2]|=(255&e.charCodeAt(i))<<24-8*(i%4);return new o.init(t,r)}},f=c.Utf8={stringify:function(e){try{return decodeURIComponent(escape(u.stringify(e)))}catch(r){throw Error("Malformed UTF-8 data")}},parse:function(e){return u.parse(unescape(encodeURIComponent(e)))}},a=i.BufferedBlockAlgorithm=n.extend({reset:function(){this._data=new o.init,this._nDataBytes=0},_append:function(e){"string"==typeof e&&(e=f.parse(e)),this._data.concat(e),this._nDataBytes+=e.sigBytes},_process:function(r){var t=this._data,i=t.words,n=t.sigBytes,c=this.blockSize,s=4*c,u=n/s;u=r?e.ceil(u):e.max((0|u)-this._minBufferSize,0);var f=u*c,a=e.min(4*f,n);if(f){for(var p=0;f>p;p+=c)this._doProcessBlock(i,p);var d=i.splice(0,f);t.sigBytes-=a}return new o.init(d,a)},clone:function(){var e=n.clone.call(this);return e._data=this._data.clone(),e},_minBufferSize:0});i.Hasher=a.extend({cfg:n.extend(),init:function(e){this.cfg=this.cfg.extend(e),this.reset()},reset:function(){a.reset.call(this),this._doReset()},update:function(e){return this._append(e),this._process(),this},finalize:function(e){e&&this._append(e);var r=this._doFinalize();return r},blockSize:16,_createHelper:function(e){return function(r,t){return new e.init(t).finalize(r)}},_createHmacHelper:function(e){return function(r,t){return new p.HMAC.init(e,t).finalize(r)}}});var p=t.algo={};return t}(Math);return e});
},{}],13:[function(require,module,exports){
(function(e,r){"object"==typeof exports?module.exports=exports=r(require("./core"),require("./sha1"),require("./hmac")):"function"==typeof define&&define.amd?define(["./core","./sha1","./hmac"],r):r(e.CryptoJS)})(this,function(e){return e.HmacSHA1});
},{"./core":12,"./hmac":14,"./sha1":15}],14:[function(require,module,exports){
(function(e,r){"object"==typeof exports?module.exports=exports=r(require("./core")):"function"==typeof define&&define.amd?define(["./core"],r):r(e.CryptoJS)})(this,function(e){(function(){var r=e,t=r.lib,n=t.Base,i=r.enc,o=i.Utf8,s=r.algo;s.HMAC=n.extend({init:function(e,r){e=this._hasher=new e.init,"string"==typeof r&&(r=o.parse(r));var t=e.blockSize,n=4*t;r.sigBytes>n&&(r=e.finalize(r)),r.clamp();for(var i=this._oKey=r.clone(),s=this._iKey=r.clone(),a=i.words,c=s.words,f=0;t>f;f++)a[f]^=1549556828,c[f]^=909522486;i.sigBytes=s.sigBytes=n,this.reset()},reset:function(){var e=this._hasher;e.reset(),e.update(this._iKey)},update:function(e){return this._hasher.update(e),this},finalize:function(e){var r=this._hasher,t=r.finalize(e);r.reset();var n=r.finalize(this._oKey.clone().concat(t));return n}})})()});
},{"./core":12}],15:[function(require,module,exports){
(function(e,r){"object"==typeof exports?module.exports=exports=r(require("./core")):"function"==typeof define&&define.amd?define(["./core"],r):r(e.CryptoJS)})(this,function(e){return function(){var r=e,t=r.lib,n=t.WordArray,i=t.Hasher,o=r.algo,s=[],c=o.SHA1=i.extend({_doReset:function(){this._hash=new n.init([1732584193,4023233417,2562383102,271733878,3285377520])},_doProcessBlock:function(e,r){for(var t=this._hash.words,n=t[0],i=t[1],o=t[2],c=t[3],a=t[4],f=0;80>f;f++){if(16>f)s[f]=0|e[r+f];else{var u=s[f-3]^s[f-8]^s[f-14]^s[f-16];s[f]=u<<1|u>>>31}var d=(n<<5|n>>>27)+a+s[f];d+=20>f?(i&o|~i&c)+1518500249:40>f?(i^o^c)+1859775393:60>f?(i&o|i&c|o&c)-1894007588:(i^o^c)-899497514,a=c,c=o,o=i<<30|i>>>2,i=n,n=d}t[0]=0|t[0]+n,t[1]=0|t[1]+i,t[2]=0|t[2]+o,t[3]=0|t[3]+c,t[4]=0|t[4]+a},_doFinalize:function(){var e=this._data,r=e.words,t=8*this._nDataBytes,n=8*e.sigBytes;return r[n>>>5]|=128<<24-n%32,r[(n+64>>>9<<4)+14]=Math.floor(t/4294967296),r[(n+64>>>9<<4)+15]=t,e.sigBytes=4*r.length,this._process(),this._hash},clone:function(){var e=i.clone.call(this);return e._hash=this._hash.clone(),e}});r.SHA1=i._createHelper(c),r.HmacSHA1=i._createHmacHelper(c)}(),e.SHA1});
},{"./core":12}]},{},[11]);
