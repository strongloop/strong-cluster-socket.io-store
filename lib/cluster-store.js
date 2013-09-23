var inherits = require('util').inherits;
var cluster = require('cluster');
var mq = require('strong-mq');
var NativeStore = require('strong-store-cluster');
var debug = require('debug')('strong-cluster-socket.io-store');

/**
 * Documentation marker for explicit setup of the shared-state server
 * in the master process. The initialization happens when this module
 * is required, thus calling this function is entirely optional.
 */
function setup() {
  // no-op
}

/**
 * Return the `ClusterStore` constructor.
 *
 * @param {Object} io socket.io module as returned by `require('socket.io')`
 * @return {function}
 */
module.exports = function(io) {

  /**
   * Initialize ClusterStore with the given `options`.
   *
   * ClusterStore is an implementation of socket.io store using node's native
   * cluster messaging.
   *
   * @param {Object} options
   * @constructor
   * @extends {io.Store}
   */
  function ClusterStore(opts) {
    io.Store.call(this, opts);
    this._connection = mq.create({ provider: 'native' });
    this._connection.open();
    this._pub = this._connection.createPubQueue('socket.io');
    this._sub = this._connection.createSubQueue('socket.io');
    this._sub.subscribe('', this._onMessage.bind(this));
    this._clientId = cluster.worker.id;
    this._subscribers = {};
    this._collection = NativeStore.collection('strong-cluster-socket.io-session-store');

    // Strong-store-cluster does not support per-key expiration value.
    // We can't access io configuration at this moment to fetch
    // the configured expiration time.
    // We use the default value of 15 seconds for now.
    this._collection.configure({ expireKeys: 15 });
  }

  inherits(ClusterStore, io.Store);

  /**
   * Publish a message to a channel.
   * @param {string} name Channel name.
   * @param {...Object} var_args Message arguments.
   * @private
   */
  ClusterStore.prototype.publish = function(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var data = {
      clientId: this._clientId,
      name: name,
      args: args
    };
    debug('publish %j', data);
    this._pub.publish(data);
  };

  /**
   * Subscribe to messages in a channel.
   * @param {string} name Channel name.
   * @param {function(...[Object])} consumer Message consumer.
   * @param {function(Error)} fn Callback on done.
   * @private
   */
  ClusterStore.prototype.subscribe = function(name, consumer, fn) {
    this._subscribers[name] = consumer;
    if (fn) process.nextTick(fn);
  };

  /**
   * Unsubscribe from messages in a channel.
   * @param {string} name Channel name.
   * @param {function(Error|string)} fn Callback on done.
   * @private
   */
  ClusterStore.prototype.unsubscribe = function(name, fn) {
    delete this._subscribers[name];
    if (fn) process.nextTick(fn);
  };

  /**
   * Message handler for strong-mq subscribe channel.
   * The handler dispatches the message to the consumer registered
   * for message's channel.
   * @param {{clientId:string, name:string, args:Array}} data
   * @private
   */
  ClusterStore.prototype._onMessage = function(data) {
    if (data.clientId === this._clientId) return;
    var consumer = this._subscribers[data.name];
    if (consumer !== undefined) {
      debug('consume %j', data);
      consumer.apply(null, data.args);
    }
  };

  /**
   * Initialize Client for given `store` and client `id`.
   *
   * @param {ClusterStore} store
   * @param {string} id
   * @constructor
   * @extends {io.Store.Client}
   * @private
   */
  function ClusterClient(store, id) {
    io.Store.Client.apply(this, arguments);
  }

  inherits(ClusterClient, io.Store.Client);

  /**
   * Acquire a keylock or get an already acquired one.
   * Calls `fn` with keylock and hashmap value (client data).
   * @param {function(Error, KeyLock, Object)} fn
   * @private
   */
  ClusterClient.prototype._getKeylock = function(fn) {
    var self = this;
    if (self._keylock) {
      return process.nextTick(function() {
        fn(null, self._keylock, self._hashmap);
      });
    }

    self.store._collection.acquire(
      self.id,
      function(err, keylock, value) {
        if (err) return fn(err);
        self._keylock = keylock;
        self._hashmap = value || {};
        fn(null, self._keylock, self._hashmap);
      }
    );
  };

  /**
   * Get the value of a key.
   * @param {string} key
   * @param {function(Error, *)} fn
   * @private
   */
  ClusterClient.prototype.get = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap[key]);
    });
  };


  /**
   * Set a value for a key.
   * @param {string} key
   * @param {*} value
   * @param {function(Error)} fn
   * @private
   */
  ClusterClient.prototype.set = function(key, value, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      hashmap[key] = value;
      fn();
    });
  };


  /**
   * Check if there is a value associated with a key.
   * @param {string} key
   * @param {function(Error,boolean)} fn
   * @private
   */
  ClusterClient.prototype.has = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap.hasOwnProperty(key));
    });
  };

  /**
   * Delete a key and it's value.
   * @param {string} key
   * @param {function(Error)} fn
   * @private
   */
  ClusterClient.prototype.del = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      delete hashmap[key];
      fn();
    });
  };

  /**
   * Destroy the client.
   * @param {?number} expiration number of seconds to expire client data
   * @private
   */
  ClusterClient.prototype.destroy = function(expiration) {
    var self = this;
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) {
        console.error('Cannot destroy socket.io client session.', err);
        return;
      }
      if (expiration) {
        keylock.set(hashmap);
        // Calling release() starts an expiry timer in master
        // which will delete the record if it is not accessed
        // within the timeout. Unfortunately it's not possible
        // to configure the timeout length at the moment.
        keylock.release();
      } else {
        keylock.del(self.id);
        keylock.release();
      }
    });
  };

  ClusterStore.Client = ClusterClient;

  /**
   * Same as `setup()` (see above).
   */
  ClusterStore.setup = setup;

  if (cluster.isMaster) {
    // See https://github.com/strongloop/sl-mq/issues/8
    mq.create({provider: 'native'}).close();
  }

  return ClusterStore;
};

module.exports.setup = setup;
