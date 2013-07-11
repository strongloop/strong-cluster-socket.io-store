var inherits = require('util').inherits;
var cluster = require('cluster');
var slmq = require('sl-mq');
var NativeStore = require('strong-store-cluster');

module.exports = function(io) {
  function ClusterStore(opts) {
    io.Store.call(this, opts);
    this._connection = slmq.create({ provider: 'native' });
    this._connection.open();
    this._pub = this._connection.createPubQueue('socket.io');
    this._sub = this._connection.createSubQueue('socket.io');
    this._sub.subscribe('', this._onMessage.bind(this));
    this._clientId = cluster.worker.id;
    this._subscribers = {};
    this._collection = NativeStore.collection('strong-cluster-socket.io-session-store');
  }

  inherits(ClusterStore, io.Store);

  ClusterStore.prototype.publish = function(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var data = {
      clientId: this._clientId,
      name: name,
      args: args
    };
    this._pub.publish(data, name);
  };

  ClusterStore.setup = function() {
    // no-op at the moment
    // this function serves as a documentation placeholder for users
    // in master.js
    //   require('strong-cluster-socket.io-store').setup();
  };

  ClusterStore.prototype.subscribe = function(name, consumer, fn) {
    this._subscribers[name] = consumer;
    if (fn) process.nextTick(fn);
  };

  ClusterStore.prototype.unsubscribe = function(name, fn) {
    delete this._subscribers[name];
    if (fn) process.nextTick(fn);
  };

  ClusterStore.prototype._onMessage = function(data) {
    if (data.clientId == this._clientId) return;
    var consumer = this._subscribers[data.name];
    if (consumer !== undefined) {
      consumer.apply(null, data.args);
    }
  };

  function ClusterClient(store, id) {
    io.Store.Client.apply(this, arguments);
  }

  inherits(ClusterClient, io.Store.Client);

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

  ClusterClient.prototype.get = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap[key]);
    });
  };


  ClusterClient.prototype.set = function(key, value, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      hashmap[key] = value;
      fn();
    });
  };


  ClusterClient.prototype.has = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      fn(null, hashmap.hasOwnProperty(key));
    });
  };

  ClusterClient.prototype.del = function(key, fn) {
    this._getKeylock(function(err, keylock, hashmap) {
      if (err) return fn(err);
      delete hashmap[key];
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
      if (expiration) {
        keylock.set(hashmap);
        keylock.release();

        var id = self.id;
        var collection = self.store._collection;
        setTimeout(function() { collection.del(id); });
      } else {
        keylock.del(self.id);
        keylock.release();
      }
    });
  };

  ClusterStore.Client = ClusterClient;

  if (cluster.isMaster) {
    // Workaround for a missing function in SL-MQ
    // See https://github.com/strongloop/sl-mq/issues/8
    slmq.create({provider: 'native'}).close();
  }

  return ClusterStore;
};
