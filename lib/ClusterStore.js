var inherits = require('util').inherits;
var cluster = require('cluster');
var slmq = require('sl-mq');
var NativeStore = require('strong-store-cluster');

module.exports = function(io) {
  var IoStore = io.Store;

  function ClusterStore(opts) {
    IoStore.call(this, opts);
    this._connection = slmq.create({ provider: 'native' });
    this._connection.open();
    this._pub = this._connection.createPubQueue('socket.io');
    this._sub = this._connection.createSubQueue('socket.io');
    this._sub.subscribe('', this._onMessage.bind(this));
    this._clientId = cluster.worker.id;
    this._subscribers = {};
    this._collection = NativeStore.collection('strong-cluster-socket.io-session-store');
  }

  inherits(ClusterStore, IoStore);

  ClusterStore.prototype.publish = function(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var data = {
      clientId: this._clientId,
      name: name,
      args: args
    };
    this._pub.publish(data, name);
  };

  ClusterStore.setupMaster = function() {
    if (!cluster.isMaster) {
      throw new Error('setupMaster must be called from cluster master');
    }

    // Workaround for a missing function in SL-MQ
    // See https://github.com/strongloop/sl-mq/issues/8
    slmq.create({provider: 'native'}).close();
  };

  ClusterStore.prototype.subscribe = function(name, consumer, fn) {
    this._subscribers[name] = consumer;
    if (fn) fn();
  };

  ClusterStore.prototype.unsubscribe = function(name, fn) {
    delete this._subscribers[name];
    if (fn) fn();
  };

  ClusterStore.prototype._onMessage = function(data) {
    if (data.clientId == this._clientId) return;
    var consumer = this._subscribers[data.name];
    if (consumer !== undefined)
      consumer.apply(null, data.args);
  };

  function ClusterClient(store, id) {
    IoStore.Client.apply(this, arguments);
  }

  inherits(ClusterClient, IoStore.Client);

  ClusterClient.prototype._getKeylock = function(fn) {
    var self = this;
    if (self._keylock) {
      return process.nextTick(function() {
        fn(null, self._keylock, self._keylock.get());
      });
    }

    self.store._collection.acquire(
      self.id,
      function(err, keylock, value) {
        if (err) return fn(err);
        self._keylock = keylock;
        fn(null, self._keylock, value);
      }
    );
  };

  ClusterClient.prototype.get = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap && hashmap[key]);
    });
  };


  ClusterClient.prototype.set = function(key, value, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      if (hashmap === undefined) hashmap = {};
      hashmap[key] = value;
      keylock.set(hashmap);
      fn();
    });
  };


  ClusterClient.prototype.has = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap !== undefined && hashmap.hasOwnProperty(key));
    });
  };

  ClusterClient.prototype.del = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      if (hashmap) {
        delete hashmap[key];
        keylock.set(hashmap);
      }
      fn();
    });
  };

  ClusterClient.prototype.destroy = function(expiration) {
    var self = this;
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) {
        console.error('Cannot destroy socket.io client session.', err);
        return;
      }
      keylock.release();

      if (expiration) {
        var id = self.id;
        var collection = self.store._collection;
        setTimeout(function() { collection.del(id); });
      }
    });
  };

  ClusterStore.Client = ClusterClient;
  return ClusterStore;
};
