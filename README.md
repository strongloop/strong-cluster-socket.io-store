strong-cluster-socket.io-store
==============================

strong-cluster-socket.io-store provides an implementation of socket.io store
using node's native cluster messaging.

# Usage

```javascript
var io = require('socket.io');
var Store = require('strong-cluster-socket.io-store')(io);

// master
store.setupMaster();

// worker
var io = require('socket.io');
io.listen(port, { store: new Store() });
```
