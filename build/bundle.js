(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.core.js":[function(require,module,exports){
"use strict";

var buffers = require("./impl/buffers");
var channels = require("./impl/channels");
var select = require("./impl/select");
var process = require("./impl/process");
var timers = require("./impl/timers");

function spawn(gen, returnChannel) {
  if (returnChannel) {
    var ch = channels.chan(buffers.fixed(1));
    (new process.Process(gen, function(value) {
      process.put_then_callback(ch, value, function(ok) {
        ch.close();
      });
    })).run();
    return ch;
  } else {
    (new process.Process(gen)).run();
    return null;
  }
};

function go(f, args, returnChannel) {
  var gen = f.apply(null, args);
  return spawn(gen, returnChannel);
};

function chan(bufferOrNumber) {
  var buf;
  if (bufferOrNumber === 0) {
    bufferOrNumber = null;
  }
  if (typeof bufferOrNumber === "number") {
    buf = buffers.fixed(bufferOrNumber);
  } else {
    buf = bufferOrNumber;
  }
  return channels.chan(buf);
};


module.exports = {
  buffers: {
    fixed: buffers.fixed,
    dropping: buffers.dropping,
    sliding: buffers.sliding
  },

  spawn: spawn,
  go: go,
  chan: chan,
  DEFAULT: select.DEFAULT,
  CLOSED: channels.CLOSED,

  put: process.put,
  take: process.take,
  sleep: process.sleep,
  alts: process.alts,
  putAsync: process.put_then_callback,
  takeAsync: process.take_then_callback,

  timeout: timers.timeout
};

},{"./impl/buffers":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/buffers.js","./impl/channels":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/channels.js","./impl/process":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/process.js","./impl/select":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/select.js","./impl/timers":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/timers.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.js":[function(require,module,exports){
"use strict";

var csp = require("./csp.core");
var operations = require("./csp.operations");

csp.operations = operations;

module.exports = csp;

},{"./csp.core":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.core.js","./csp.operations":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.operations.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.operations.js":[function(require,module,exports){
"use strict";

var Box = require("./impl/channels").Box;

var csp = require("./csp.core"),
    go = csp.go,
    take = csp.take,
    put = csp.put,
    takeAsync = csp.takeAsync,
    putAsync = csp.putAsync,
    alts = csp.alts,
    chan = csp.chan,
    CLOSED = csp.CLOSED;


function noOp(v) {
}

function mapFrom(f, ch) {
  return {
    is_closed: function() {
      return ch.is_closed();
    },
    close: function() {
      ch.close();
    },
    _put: function(value, handler) {
      return ch._put(value, handler);
    },
    _take: function(handler) {
      var result = ch._take({
        is_active: function() {
          return handler.is_active();
        },
        commit: function() {
          var take_cb = handler.commit();
          return function(value) {
            return take_cb(value === CLOSED ? CLOSED : f(value));
          };
        }
      });
      if (result) {
        var value = result.value;
        return new Box(value === CLOSED ? CLOSED : f(value));
      } else {
        return null;
      }
    }
  };
}

function mapInto(f, ch) {
  return {
    is_closed: function() {
      return ch.is_closed();
    },
    close: function() {
      ch.close();
    },
    _put: function(value, handler) {
      return ch._put(f(value), handler);
    },
    _take: function(handler) {
      return ch._take(handler);
    }
  };
}

function filterFrom(p, ch, bufferOrN) {
  var out = chan(bufferOrN);
  go(function*() {
    while (true) {
      var value = yield take(ch);
      if (value === CLOSED) {
        out.close();
        break;
      }
      if (p(value)) {
        yield put(out, value);
      }
    }
  });
  return out;
}

function filterInto(p, ch) {
  return {
    is_closed: function() {
      return ch.is_closed();
    },
    close: function() {
      ch.close();
    },
    _put: function(value, handler) {
      if (p(value)) {
        return ch._put(value, handler);
      } else {
        return new Box(!ch.is_closed());
      }
    },
    _take: function(handler) {
      return ch._take(handler);
    }
  };
}

function removeFrom(p, ch) {
  return filterFrom(function(value) {
    return !p(value);
  }, ch);
}

function removeInto(p, ch) {
  return filterInto(function(value) {
    return !p(value);
  }, ch);
}

function* mapcat(f, src, dst) {
  while (true) {
    var value = yield take(src);
    if (value === CLOSED) {
      dst.close();
      break;
    } else {
      var seq = f(value);
      var length = seq.length;
      for (var i = 0; i < length; i++) {
        yield put(dst, seq[i]);
      }
      if (dst.is_closed()) {
        break;
      }
    }
  }
}

function mapcatFrom(f, ch, bufferOrN) {
  var out = chan(bufferOrN);
  go(mapcat, [f, ch, out]);
  return out;
}

function mapcatInto(f, ch, bufferOrN) {
  var src = chan(bufferOrN);
  go(mapcat, [f, src, ch]);
  return src;
}

function pipe(src, dst, keepOpen) {
  go(function*() {
    while (true) {
      var value = yield take(src);
      if (value === CLOSED) {
        if (!keepOpen) {
          dst.close();
        }
        break;
      }
      if (!(yield put(dst, value))) {
        break;
      }
    }
  });
  return dst;
}

function split(p, ch, trueBufferOrN, falseBufferOrN) {
  var tch = chan(trueBufferOrN);
  var fch = chan(falseBufferOrN);
  go(function*() {
    while (true) {
      var value = yield take(ch);
      if (value === CLOSED) {
        tch.close();
        fch.close();
        break;
      }
      yield put(p(value) ? tch : fch, value);
    }
  });
  return [tch, fch];
}

function reduce(f, init, ch) {
  return go(function*() {
    var result = init;
    while (true) {
      var value = yield take(ch);
      if (value === CLOSED) {
        return result;
      } else {
        result = f(result, value);
      }
    }
  }, [], true);
}

function onto(ch, coll, keepOpen) {
  return go(function*() {
    var length = coll.length;
    // FIX: Should be a generic looping interface (for...in?)
    for (var i = 0; i < length; i++) {
      yield put(ch, coll[i]);
    }
    if (!keepOpen) {
      ch.close();
    }
  });
}

// TODO: Bounded?
function fromColl(coll) {
  var ch = chan(coll.length);
  onto(ch, coll);
  return ch;
}

function map(f, chs, bufferOrN) {
  var out = chan(bufferOrN);
  var length = chs.length;
  // Array holding 1 round of values
  var values = new Array(length);
  // TODO: Not sure why we need a size-1 buffer here
  var dchan = chan(1);
  // How many more items this round
  var dcount;
  // put callbacks for each channel
  var dcallbacks = new Array(length);
  for (var i = 0; i < length; i ++) {
    dcallbacks[i] = (function(i) {
      return function(value) {
        values[i] = value;
        dcount --;
        if (dcount === 0) {
          putAsync(dchan, values.slice(0), noOp);
        }
      };
    }(i));
  }
  go(function*() {
    while (true) {
      dcount = length;
      // We could just launch n goroutines here, but for effciency we
      // don't
      for (var i = 0; i < length; i ++) {
        try {
          takeAsync(chs[i], dcallbacks[i]);
        } catch (e) {
          // FIX: Hmm why catching here?
          dcount --;
        }
      }
      var values = yield take(dchan);
      for (i = 0; i < length; i ++) {
        if (values[i] === CLOSED) {
          out.close();
          return;
        }
      }
      yield put(out, f.apply(null, values));
    }
  });
  return out;
}

function merge(chs, bufferOrN) {
  var out = chan(bufferOrN);
  var actives = chs.slice(0);
  go(function*() {
    while (true) {
      if (actives.length === 0) {
        break;
      }
      var r = yield alts(actives);
      var value = r.value;
      if (value === CLOSED) {
        // Remove closed channel
        var i = actives.indexOf(r.channel);
        actives.splice(i, 1);
        continue;
      }
      yield put(out, value);
    }
    out.close();
  });
  return out;
}

function into(coll, ch) {
  var result = coll.slice(0);
  return reduce(function(result, item) {
    result.push(item);
    return result;
  }, result, ch);
}

function takeN(n, ch, bufferOrN) {
  var out = chan(bufferOrN);
  go(function*() {
    for (var i = 0; i < n; i ++) {
      var value = yield take(ch);
      if (value === CLOSED) {
        break;
      }
      yield put(out, value);
    }
    out.close();
  });
  return out;
}

var NOTHING = {};

function unique(ch, bufferOrN) {
  var out = chan(bufferOrN);
  var last = NOTHING;
  go(function*() {
    while (true) {
      var value = yield take(ch);
      if (value === CLOSED) {
        break;
      }
      if (value === last) {
        continue;
      }
      last = value;
      yield put(out, value);
    }
    out.close();
  });
  return out;
}

function partitionBy(f, ch, bufferOrN) {
  var out = chan(bufferOrN);
  var part = [];
  var last = NOTHING;
  go(function*() {
    while (true) {
      var value = yield take(ch);
      if (value === CLOSED) {
        if (part.length > 0) {
          yield put(out, part);
        }
        out.close();
        break;
      } else {
        var newItem = f(value);
        if (newItem === last || last === NOTHING) {
          part.push(value);
        } else {
          yield put(out, part);
          part = [value];
        }
        last = newItem;
      }
    }
  });
  return out;
}

function partition(n, ch, bufferOrN) {
  var out = chan(bufferOrN);
  go(function*() {
    while (true) {
      var part = new Array(n);
      for (var i = 0; i < n; i++) {
        var value = yield take(ch);
        if (value === CLOSED) {
          if (i > 0) {
            yield put(out, part.slice(0, i));
          }
          out.close();
          return;
        }
        part[i] = value;
      }
      yield put(out, part);
    }
  });
  return out;
}

// For channel identification
var genId = (function() {
  var i = 0;
  return function() {
    i ++;
    return "" + i;
  };
})();

var ID_ATTR = "__csp_channel_id";

// TODO: Do we need to check with hasOwnProperty?
function len(obj) {
  var count = 0;
  for (var p in obj) {
    count ++;
  }
  return count;
}

function chanId(ch) {
  var id = ch[ID_ATTR];
  if (id === undefined) {
    id = ch[ID_ATTR] = genId();
  }
  return id;
}

var Mult = function(ch) {
  this.taps = {};
  this.ch = ch;
};

var Tap = function(channel, keepOpen) {
  this.channel = channel;
  this.keepOpen = keepOpen;
};

Mult.prototype.muxch = function() {
  return this.ch;
};

Mult.prototype.tap = function(ch, keepOpen) {
  var id = chanId(ch);
  this.taps[id] = new Tap(ch, keepOpen);
};

Mult.prototype.untap = function(ch) {
  delete this.taps[chanId(ch)];
};

Mult.prototype.untapAll = function() {
  this.taps = {};
};

function mult(ch) {
  var m = new Mult(ch);
  var dchan = chan(1);
  var dcount;
  function makeDoneCallback(tap) {
    return function(stillOpen) {
      dcount --;
      if (dcount === 0) {
        putAsync(dchan, true, noOp);
      }
      if (!stillOpen) {
        m.untap(tap.channel);
      }
    };
  }
  go(function*() {
    while (true) {
      var value = yield take(ch);
      var id, t;
      var taps = m.taps;
      if (value === CLOSED) {
        for (id in taps) {
          t = taps[id];
          if (!t.keepOpen) {
            t.channel.close();
          }
        }
        // TODO: Is this necessary?
        m.untapAll();
        break;
      }
      dcount = len(taps);
      // XXX: This is because putAsync can actually call back
      // immediately. Fix that
      var initDcount = dcount;
      // Put value on tapping channels...
      for (id in taps) {
        t = taps[id];
        putAsync(t.channel, value, makeDoneCallback(t));
      }
      // ... waiting for all puts to complete
      if (initDcount > 0) {
        yield take(dchan);
      }
    }
  });
  return m;
}

mult.tap = function tap(m, ch, keepOpen) {
  m.tap(ch, keepOpen);
  return ch;
};

mult.untap = function untap(m, ch) {
  m.untap(ch);
};

mult.untapAll = function untapAll(m) {
  m.untapAll();
};

function constantlyNull() {
  return null;
}

var Pub = function(ch, topicFn, bufferFn) {
  this.ch = ch;
  this.topicFn = topicFn;
  this.bufferFn = bufferFn;
  this.mults = {};
};

Pub.prototype._ensureMult = function(topic) {
  var m = this.mults[topic];
  var bufferFn = this.bufferFn;
  if (!m) {
    m = this.mults[topic] = mult(chan(bufferFn(topic)));
  }
  return m;
};

Pub.prototype.sub = function(topic, ch, keepOpen) {
  var m = this._ensureMult(topic);
  return mult.tap(m, ch, keepOpen);
};

Pub.prototype.unsub = function(topic, ch) {
  var m = this.mults[topic];
  if (m) {
    mult.untap(m, ch);
  }
};

Pub.prototype.unsubAll = function(topic) {
  if (topic === undefined) {
    this.mults = {};
  } else {
    delete this.mults[topic];
  }
};

function pub(ch, topicFn, bufferFn) {
  bufferFn = bufferFn || constantlyNull;
  var p = new Pub(ch, topicFn, bufferFn);
  go(function*() {
    while (true) {
      var value = yield take(ch);
      var mults = p.mults;
      var topic;
      if (value === CLOSED) {
        for (topic in mults) {
          mults[topic].muxch().close();
        }
        break;
      }
      // TODO: Somehow ensure/document that this must return a string
      // (otherwise use proper (hash)maps)
      topic = topicFn(value);
      var m = mults[topic];
      if (m) {
        var stillOpen = yield put(m.muxch(), value);
        if (!stillOpen) {
          delete mults[topic];
        }
      }
    }
  });
  return p;
}

pub.sub = function sub(p, topic, ch, keepOpen) {
  return p.sub(topic, ch, keepOpen);
};

pub.unsub = function unsub(p, topic, ch) {
  p.unsub(topic, ch);
};

pub.unsubAll = function unsubAll(p, topic) {
  p.unsubAll(topic);
};

module.exports = {
  mapFrom: mapFrom,
  mapInto: mapInto,
  filterFrom: filterFrom,
  filterInto: filterInto,
  removeFrom: removeFrom,
  removeInto: removeInto,
  mapcatFrom: mapcatFrom,
  mapcatInto: mapcatInto,

  pipe: pipe,
  split: split,
  reduce: reduce,
  onto: onto,
  fromColl: fromColl,

  map: map,
  merge: merge,
  into: into,
  take: takeN,
  unique: unique,
  partition: partition,
  partitionBy: partitionBy
};


// Possible "fluid" interfaces:

// thread(
//   [fromColl, [1, 2, 3, 4]],
//   [mapFrom, inc],
//   [into, []]
// )

// thread(
//   [fromColl, [1, 2, 3, 4]],
//   [mapFrom, inc, _],
//   [into, [], _]
// )

// wrap()
//   .fromColl([1, 2, 3, 4])
//   .mapFrom(inc)
//   .into([])
//   .unwrap();

},{"./csp.core":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.core.js","./impl/channels":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/channels.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/buffers.js":[function(require,module,exports){
"use strict";

// TODO: Consider EmptyError & FullError to avoid redundant bound
// checks, to improve performance (may need benchmarks)

function acopy(src, src_start, dst, dst_start, length) {
  var count = 0;
  while (true) {
    if (count >= length) {
      break;
    }
    dst[dst_start + count] = src[src_start + count];
    count ++;
  }
}

var EMPTY = {
  toString: function() {
    return "[object EMPTY]";
  }
};

var RingBuffer = function(head, tail, length, array) {
  this.length = length;
  this.array = array;
  this.head = head;
  this.tail = tail;
};

// Internal method, callers must do bound check
RingBuffer.prototype._unshift = function(item) {
  var array = this.array;
  var head = this.head;
  array[head] = item;
  this.head = (head + 1) % array.length;
  this.length ++;
};

RingBuffer.prototype._resize = function() {
  var array = this.array;
  var new_length = 2 * array.length;
  var new_array = new Array(new_length);
  var head = this.head;
  var tail = this.tail;
  var length = this.length;
  if (tail < head) {
    acopy(array, tail, new_array, 0, length);
    this.tail = 0;
    this.head = length;
    this.array = new_array;
  } else if (tail > head) {
    acopy(array, tail, new_array, 0, array.length - tail);
    acopy(array, 0, new_array, array.length - tail, head);
    this.tail = 0;
    this.head = length;
    this.array = new_array;
  } else if (tail === head) {
    this.tail = 0;
    this.head = 0;
    this.array = new_array;
  }
};

RingBuffer.prototype.unbounded_unshift = function(item) {
  if (this.length + 1 === this.array.length) {
    this._resize();
  }
  this._unshift(item);
};

RingBuffer.prototype.pop = function() {
  if (this.length === 0) {
    return EMPTY;
  }
  var array = this.array;
  var tail = this.tail;
  var item = array[tail];
  array[tail] = null;
  this.tail = (tail + 1) % array.length;
  this.length --;
  return item;
};

RingBuffer.prototype.cleanup = function(predicate) {
  var length = this.length;
  for (var i = 0; i < length; i++) {
    var item = this.pop();
    if (predicate(item)) {
      this._unshift(item);
    }
  }
};


var FixedBuffer = function(buf,  n) {
  this.buf = buf;
  this.n = n;
};

FixedBuffer.prototype.is_full = function() {
  return this.buf.length == this.n;
};

FixedBuffer.prototype.remove = function() {
  return this.buf.pop();
};

FixedBuffer.prototype.add = function(item) {
  if (this.is_full()) {
    throw new Error("Can't add to a full buffer");
  }
  this.buf._unshift(item);
};

FixedBuffer.prototype.count = function() {
  return this.buf.length;
};


var DroppingBuffer = function(buf, n) {
  this.buf = buf;
  this.n = n;
};

DroppingBuffer.prototype.is_full = function() {
  return false;
};

DroppingBuffer.prototype.remove = function() {
  return this.buf.pop();
};

DroppingBuffer.prototype.add = function(item) {
  if (this.buf.length < this.n) {
    this.buf._unshift(item);
  }
};

DroppingBuffer.prototype.count = function() {
  return this.buf.length;
};


var SlidingBuffer = function(buf, n) {
  this.buf = buf;
  this.n = n;
};

SlidingBuffer.prototype.is_full = function() {
  return false;
};

SlidingBuffer.prototype.remove = function() {
  return this.buf.pop();
};

SlidingBuffer.prototype.add = function(item) {
  if (this.buf.length === this.n) {
    this.buf.pop();
  }
  this.buf._unshift(item);
};

SlidingBuffer.prototype.count = function() {
  return this.buf.length;
};


var ring = exports.ring = function ring_buffer(n) {
  return new RingBuffer(0, 0, 0, new Array(n));
};

exports.fixed = function fixed_buffer(n) {
  return new FixedBuffer(ring(n), n);
};

exports.dropping = function dropping_buffer(n) {
  return new DroppingBuffer(ring(n), n);
};

exports.sliding = function sliding_buffer(n) {
  return new SlidingBuffer(ring(n), n);
};

exports.EMPTY = EMPTY;

},{}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/channels.js":[function(require,module,exports){
"use strict";

var buffers = require("./buffers");
var dispatch = require("./dispatch");

var MAX_DIRTY = 64;
var MAX_QUEUE_SIZE = 1024;

var CLOSED = null;

var Box = function(value) {
  this.value = value;
};

var PutBox = function(handler, value) {
  this.handler = handler;
  this.value = value;
};

var Channel = function(takes, puts, buf) {
  this.buf = buf;
  this.takes = takes;
  this.puts = puts;

  this.dirty_takes = 0;
  this.dirty_puts = 0;
  this.closed = false;
};

Channel.prototype._put = function(value, handler) {
  if (value === CLOSED) {
    throw new Error("Cannot put CLOSED on a channel.");
  }

  if (this.closed || !handler.is_active()) {
    return new Box(!this.closed);
  }

  while (true) {
    var taker = this.takes.pop();
    if (taker !== buffers.EMPTY) {
      if (taker.is_active()) {
        var callback = taker.commit();
        handler.commit();
        dispatch.run(function() {
          callback(value);
        });
        return new Box(true);
      } else {
        continue;
      }
    } else {
      if (this.buf && !this.buf.is_full()) {
        handler.commit();
        this.buf.add(value);
        return new Box(true);
      } else {
        if (this.dirty_puts > MAX_DIRTY) {
          this.puts.cleanup(function(putter) {
            return putter.handler.is_active();
          });
          this.dirty_puts = 0;
        } else {
          this.dirty_puts ++;
        }
        if (this.puts.length >= MAX_QUEUE_SIZE) {
          throw new Error("No more than " + MAX_QUEUE_SIZE + " pending puts are allowed on a single channel.");
        }
        this.puts.unbounded_unshift(new PutBox(handler, value));
      }
    }
    break;
  }

  return null;
};

Channel.prototype._take = function(handler) {
  if (!handler.is_active()) {
    return null;
  }

  var putter, put_handler, callback;

  if (this.buf && this.buf.count() > 0) {
    handler.commit();
    var value = this.buf.remove();
    // We need to check pending puts here, other wise they won't
    // be able to proceed until their number reaches MAX_DIRTY
    while (true) {
      putter = this.puts.pop();
      if (putter !== buffers.EMPTY) {
        put_handler = putter.handler;
        if (put_handler.is_active()) {
          callback = put_handler.commit();
          dispatch.run(function() {
            callback(true);
          });
          this.buf.add(putter.value);
          break;
        } else {
          continue;
        }
      }
      break;
    }
    return new Box(value);
  }

  while (true) {
    putter = this.puts.pop();
    if (putter !== buffers.EMPTY) {
      put_handler = putter.handler;
      if (put_handler.is_active()) {
        handler.commit();
        callback = put_handler.commit();
        dispatch.run(function() {
          callback(true);
        });
        return new Box(putter.value);
      } else {
        continue;
      }
    } else {
      if (this.closed) {
        handler.commit();
        return new Box(CLOSED);
      } else {
        if (this.dirty_takes > MAX_DIRTY) {
          this.takes.cleanup(function(handler) {
            return handler.is_active();
          });
          this.dirty_takes = 0;
        } else {
          this.dirty_takes ++;
        }
        if (this.takes.length >= MAX_QUEUE_SIZE) {
          throw new Error("No more than " + MAX_QUEUE_SIZE + " pending takes are allowed on a single channel.");
        }
        this.takes.unbounded_unshift(handler);
      }
    }
    break;
  }

  return null;
};

Channel.prototype.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  while (true) {
    var taker = this.takes.pop();
    if (taker === buffers.EMPTY) {
      break;
    }
    if (taker.is_active()) {
      var callback = taker.commit();
      dispatch.run(function() {
        callback(CLOSED);
      });
    }
  }
  // TODO: Tests
  while (true) {
    var putter = this.puts.pop();
    if (putter === buffers.EMPTY) {
      break;
    }
    if (putter.handler.is_active()) {
      var put_callback = putter.handler.commit();
      dispatch.run(function() {
        put_callback(false);
      });
    }
  }
};


Channel.prototype.is_closed = function() {
  return this.closed;
};


exports.chan = function(buf) {
  return new Channel(buffers.ring(32), buffers.ring(32), buf);
};

exports.Box = Box;

exports.CLOSED = CLOSED;

},{"./buffers":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/buffers.js","./dispatch":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/dispatch.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/dispatch.js":[function(require,module,exports){
"use strict";

// TODO: Use process.nextTick if it's available since it's more
// efficient
// http://howtonode.org/understanding-process-next-tick
// Maybe we don't even need to queue ourselves in that case?

// XXX: But http://blog.nodejs.org/2013/03/11/node-v0-10-0-stable/
// Looks like it will blow up the stack (or is that just about
// pre-empting IO (but that's already bad enough IMO)?)

// Looks like
// http://nodejs.org/api/process.html#process_process_nexttick_callback
// is the equivalent of our TASK_BATCH_SIZE

var buffers = require("./buffers");

var TASK_BATCH_SIZE = 1024;

var tasks = buffers.ring(32);
var running = false;
var queued = false;

var queue_dispatcher;

function process_messages() {
  running = true;
  queued = false;
  var count = 0;
  while (true) {
    var task = tasks.pop();
    if (task === buffers.EMPTY) {
      break;
    }
    // TODO: Don't we need a try/finally here?
    task();
    if (count >= TASK_BATCH_SIZE) {
      break;
    }
    count ++;
  }
  running = false;
  if (tasks.length > 0) {
    queue_dispatcher();
  }
}

if (typeof MessageChannel !== "undefined") {
  var message_channel = new MessageChannel();
  message_channel.port1.onmessage = function(_) {
    process_messages();
  };
  queue_dispatcher = function()  {
    if (!(queued && running)) {
      queued = true;
      message_channel.port2.postMessage(0);
    }
  };
} else if (typeof setImmediate !== "undefined") {
  queue_dispatcher = function() {
    if (!(queued && running)) {
      queued = true;
      setImmediate(process_messages);
    }
  };
} else {
  queue_dispatcher = function() {
    if (!(queued && running)) {
      queued = true;
      setTimeout(process_messages, 0);
    }
  };
}

exports.run = function (f) {
  tasks.unbounded_unshift(f);
  queue_dispatcher();
};

exports.queue_delay = function(f, delay) {
  setTimeout(f, delay);
};

},{"./buffers":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/buffers.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/process.js":[function(require,module,exports){
"use strict";

var dispatch = require("./dispatch");
var select = require("./select");

var FnHandler = function(f) {
  this.f = f;
};

FnHandler.prototype.is_active = function() {
  return true;
};

FnHandler.prototype.commit = function() {
  return this.f;
};

function put_then_callback(channel, value, callback) {
  var result = channel._put(value, new FnHandler(callback));
  if (result) {
    callback(result.value);
  }
}

function take_then_callback(channel, callback) {
  var result = channel._take(new FnHandler(callback));
  if (result) {
    callback(result.value);
  }
}

var Process = function(gen, onFinish) {
  this.gen = gen;
  this.finished = false;
  this.onFinish = onFinish;
};

var Instruction = function(op, data) {
  this.op = op;
  this.data = data;
};

var TAKE = "take";
var PUT = "put";
var SLEEP = "sleep";
var ALTS = "alts";

// TODO FIX XXX: This is a (probably) temporary hack to avoid blowing
// up the stack, but it means double queueing when the value is not
// immediately available
Process.prototype._continue = function(response) {
  var self = this;
  dispatch.run(function() {
    self.run(response);
  });
};

Process.prototype._done = function(value) {
  if (!this.finished) {
    this.finished = true;
    var onFinish = this.onFinish;
    if (typeof onFinish === "function") {
      dispatch.run(function() {
        onFinish(value);
      });
    }
  }
};

Process.prototype.run = function(response) {
  if (this.finished) {
    return;
  }

  // TODO: Shouldn't we (optionally) stop error propagation here (and
  // signal the error through a channel or something)? Otherwise the
  // uncaught exception will crash some runtimes (e.g. Node)
  var iter = this.gen.next(response);
  if (iter.done) {
    this._done(iter.value);
    return;
  }

  var ins = iter.value;

  if (ins instanceof Instruction) {
    var self = this;
    switch (ins.op) {
    case PUT:
      var data = ins.data;
      put_then_callback(data.channel, data.value, function(ok) {
        self._continue(ok);
      });
      break;

    case TAKE:
      var channel = ins.data;
      take_then_callback(channel, function(value) {
        self._continue(value);
      });
      break;

    case SLEEP:
      var msecs = ins.data;
      dispatch.queue_delay(function() {
        self.run(null);
      }, msecs);
      break;

    case ALTS:
      select.do_alts(ins.data.operations, function(result) {
        self._continue(result);
      }, ins.data.options);
      break;
    }
  } else {
    this._continue(ins);
  }
};

function take(channel) {
  return new Instruction(TAKE, channel);
}

function put(channel, value) {
  return new Instruction(PUT, {
    channel: channel,
    value: value
  });
}

function sleep(msecs) {
  return new Instruction(SLEEP, msecs);
}

function alts(operations, options) {
  return new Instruction(ALTS, {
    operations: operations,
    options: options
  });
}

exports.put_then_callback = put_then_callback;
exports.take_then_callback = take_then_callback;
exports.put = put;
exports.take = take;
exports.sleep = sleep;
exports.alts = alts;

exports.Process = Process;

},{"./dispatch":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/dispatch.js","./select":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/select.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/select.js":[function(require,module,exports){
"use strict";

var Box = require("./channels").Box;

var AltHandler = function(flag, f) {
  this.f = f;
  this.flag = flag;
};

AltHandler.prototype.is_active = function() {
  return this.flag.value;
};

AltHandler.prototype.commit = function() {
  this.flag.value = false;
  return this.f;
};

var AltResult = function(value, channel) {
  this.value = value;
  this.channel = channel;
};

function rand_int(n) {
  return Math.floor(Math.random() * (n + 1));
}

function random_array(n) {
  var a = new Array(n);
  var i;
  for (i = 0; i < n; i++) {
    a[i] = 0;
  }
  for (i = 1; i < n; i++) {
    var j = rand_int(i);
    a[i] = a[j];
    a[j] = i;
  }
  return a;
}

var hasOwnProperty = Object.prototype.hasOwnProperty;

var DEFAULT = {
  toString: function() {
    return "[object DEFAULT]";
  }
};

// TODO: Accept a priority function or something
exports.do_alts = function(operations, callback, options) {
  var length = operations.length;
  // XXX Hmm
  if (length === 0) {
    throw new Error("Empty alt list");
  }

  var priority = (options && options.priority) ? true : false;
  if (!priority) {
    var indexes = random_array(length);
  }

  var flag = new Box(true);

  for (var i = 0; i < length; i++) {
    var operation = operations[priority ? i : indexes[i]];
    var port, result;
    // XXX Hmm
    if (operation instanceof Array) {
      var value = operation[1];
      port = operation[0];
      result = port._put(value, (function(port) {
        return new AltHandler(flag, function(ok) {
          callback(new AltResult(ok, port));
        });
      })(port));
    } else {
      port = operation;
      result = port._take((function(port) {
        return new AltHandler(flag, function(value) {
          callback(new AltResult(value, port));
        });
      })(port));
    }
    // XXX Hmm
    if (result instanceof Box) {
      callback(new AltResult(result.value, port));
      break;
    }
  }

  if (!(result instanceof Box)
      && options
      && hasOwnProperty.call(options, "default")) {
    if (flag.value) {
      flag.value = false;
      callback(new AltResult(options["default"], DEFAULT));
    }
  }
};

exports.DEFAULT = DEFAULT;

},{"./channels":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/channels.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/timers.js":[function(require,module,exports){
"use strict";

var dispatch = require("./dispatch");
var channels = require("./channels");

exports.timeout = function timeout_channel(msecs) {
  var chan = channels.chan();
  dispatch.queue_delay(function() {
    chan.close();
  }, msecs);
  return chan;
};

},{"./channels":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/channels.js","./dispatch":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/impl/dispatch.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/underscore/underscore.js":[function(require,module,exports){
//     Underscore.js 1.7.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.7.0';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var createCallback = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  _.iteratee = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return createCallback(value, context, argCount);
    if (_.isObject(value)) return _.matches(value);
    return _.property(value);
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    if (obj == null) return obj;
    iteratee = createCallback(iteratee, context);
    var i, length = obj.length;
    if (length === +length) {
      for (i = 0; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    if (obj == null) return [];
    iteratee = _.iteratee(iteratee, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length),
        currentKey;
    for (var index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index = 0, currentKey;
    if (arguments.length < 3) {
      if (!length) throw new TypeError(reduceError);
      memo = obj[keys ? keys[index++] : index++];
    }
    for (; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = function(obj, iteratee, memo, context) {
    if (obj == null) obj = [];
    iteratee = createCallback(iteratee, context, 4);
    var keys = obj.length !== + obj.length && _.keys(obj),
        index = (keys || obj).length,
        currentKey;
    if (arguments.length < 3) {
      if (!index) throw new TypeError(reduceError);
      memo = obj[keys ? keys[--index] : --index];
    }
    while (index--) {
      currentKey = keys ? keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    predicate = _.iteratee(predicate, context);
    _.some(obj, function(value, index, list) {
      if (predicate(value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    predicate = _.iteratee(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(_.iteratee(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    if (obj == null) return true;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    if (obj == null) return false;
    predicate = _.iteratee(predicate, context);
    var keys = obj.length !== +obj.length && _.keys(obj),
        length = (keys || obj).length,
        index, currentKey;
    for (index = 0; index < length; index++) {
      currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (obj.length !== +obj.length) obj = _.values(obj);
    return _.indexOf(obj, target) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = obj.length === +obj.length ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = obj && obj.length === +obj.length ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = _.iteratee(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = _.iteratee(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = low + high >>> 1;
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return obj.length === +obj.length ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = _.iteratee(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    for (var i = 0, length = input.length; i < length; i++) {
      var value = input[i];
      if (!_.isArray(value) && !_.isArguments(value)) {
        if (!strict) output.push(value);
      } else if (shallow) {
        push.apply(output, value);
      } else {
        flatten(value, shallow, strict, output);
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (array == null) return [];
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = _.iteratee(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = array.length; i < length; i++) {
      var value = array[i];
      if (isSorted) {
        if (!i || seen !== value) result.push(value);
        seen = value;
      } else if (iteratee) {
        var computed = iteratee(value, i, array);
        if (_.indexOf(seen, computed) < 0) {
          seen.push(computed);
          result.push(value);
        }
      } else if (_.indexOf(result, value) < 0) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true, []));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    if (array == null) return [];
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = array.length; i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(slice.call(arguments, 1), true, true, []);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function(array) {
    if (array == null) return [];
    var length = _.max(arguments, 'length').length;
    var results = Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = isSorted < 0 ? Math.max(0, length + isSorted) : isSorted;
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var idx = array.length;
    if (typeof from == 'number') {
      idx = from < 0 ? idx + from + 1 : Math.min(idx, from + 1);
    }
    while (--idx >= 0) if (array[idx] === item) return idx;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var Ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    args = slice.call(arguments, 2);
    bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      Ctor.prototype = func.prototype;
      var self = new Ctor;
      Ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (_.isObject(result)) return result;
      return self;
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = hasher ? hasher.apply(this, arguments) : key;
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last > 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed before being called N times.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      } else {
        func = null;
      }
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    if (!_.isObject(obj)) return obj;
    var source, prop;
    for (var i = 1, length = arguments.length; i < length; i++) {
      source = arguments[i];
      for (prop in source) {
        if (hasOwnProperty.call(source, prop)) {
            obj[prop] = source[prop];
        }
      }
    }
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj, iteratee, context) {
    var result = {}, key;
    if (obj == null) return result;
    if (_.isFunction(iteratee)) {
      iteratee = createCallback(iteratee, context);
      for (key in obj) {
        var value = obj[key];
        if (iteratee(value, key, obj)) result[key] = value;
      }
    } else {
      var keys = concat.apply([], slice.call(arguments, 1));
      obj = new Object(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        key = keys[i];
        if (key in obj) result[key] = obj[key];
      }
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(concat.apply([], slice.call(arguments, 1)), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    if (!_.isObject(obj)) return obj;
    for (var i = 1, length = arguments.length; i < length; i++) {
      var source = arguments[i];
      for (var prop in source) {
        if (obj[prop] === void 0) obj[prop] = source[prop];
      }
    }
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (
      aCtor !== bCtor &&
      // Handle Object.create(x) cases
      'constructor' in a && 'constructor' in b &&
      !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
        _.isFunction(bCtor) && bCtor instanceof bCtor)
    ) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size, result;
    // Recursively compare objects and arrays.
    if (className === '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size === b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      size = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      result = _.keys(b).length === size;
      if (result) {
        while (size--) {
          // Deep compare each member
          key = keys[size];
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj) || _.isArguments(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around an IE 11 bug.
  if (typeof /./ !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    var pairs = _.pairs(attrs), length = pairs.length;
    return function(obj) {
      if (obj == null) return !length;
      obj = new Object(obj);
      for (var i = 0; i < length; i++) {
        var pair = pairs[i], key = pair[0];
        if (pair[1] !== obj[key] || !(key in obj)) return false;
      }
      return true;
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = createCallback(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? object[property]() : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));

},{}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/canvas-util.js":[function(require,module,exports){
// Note that in more complex CSS rules coordinates formula could be different
// The value of this property must be the same as the one specified in the css file
var canvasBorder = 1;
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext('2d');

module.exports = {
  getCoordinates: function (e) {
    var x;
    var y;
    if (e.pageX != undefined && e.pageY != undefined) {
      return {
  	    x: e.pageX - canvas.offsetLeft - 1,
  	    y: e.pageY - canvas.offsetTop - 1
      }
    } else {
      return {
  	    x: e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft - canvas.offsetLeft - canvasBorder,
  	    y: e.clientY + document.body.scrollTop + document.documentElement.scrollTop - canvas.offsetTop - canvasBorder
      }
    }
  },

  drawTriangle: function(points, color) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineTo(points[2].x, points[2].y);
    ctx.fillStyle = color;
    ctx.fill();
  },
  
  visualiseDrawing: function(data) {
    var img = new Image;
    img.src = data;
    img.onload = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);      
      ctx.drawImage(img, 0, 0)
    }    
  },
  
  clearCanvas: function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);  
  }
}

},{}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/index.js":[function(require,module,exports){
// LIBS
var _ = require("underscore");
var csp = require("js-csp");
var start = csp.go;
var storage = require("./storage");
var producers = require("./producers");
var cutil = require("./canvas-util");
var selectFile = document.getElementById("selectFile");

// STATE
var currentColor = "#62a2fc";
var fileNameToSave = document.getElementById("fname");
var fileNameToOpen = ""


// START CONSUMER CHANNELS
start(canvasClickHandler);
start(selectOnChangeHandler);
start(resetButtonHandler);
start(storeButtonHandler);
start(openButtonHandler);
start(colorPickerHandler);



// INITIALIZATION
initSelectBox();
function initSelectBox() {
  var drawingNames = storage.getAllDrawingNames();
  if (!_.isEmpty(drawingNames)) {
    var html = _.reduce(drawingNames, function (memo, name, index) {
      if (index == 0) {
        //Sets the current selection to the first file in the list after each reinitialisation
        fileNameToOpen = name;
      }
      return memo.concat("<option value=" + name + ">" + name + "</option>");
    }, "");
    selectFile.innerHTML = html;
  }  
}

// LOGIC
function *colorPickerHandler() {
  while (true) {
    var event = yield csp.take(producers.channelColorPicker);
    event.srcElement ? currentColor = event.srcElement.value : currentColor = event.target.value
  }
}

function *openButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelOpenButton);
    var drawing = storage.find(fileNameToOpen);
    if (null !== drawing) {
      cutil.visualiseDrawing(drawing);
    }
  }
}

function *storeButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelStoreButton);
    storage.save(fileNameToSave.innerHTML, canvas.toDataURL());
    fileNameToSave.innerHTML = "";
    initSelectBox();
  }
}

function *resetButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelResetButton);
    cutil.clearCanvas();
  }
}

function *selectOnChangeHandler() {
  while (true) {
    var event = yield csp.take(producers.channelSelectFile);
    event.srcElement ? fileNameToOpen = event.srcElement.value : fileNameToOpen = event.target.value;
  }
}

function *canvasClickHandler() {
  var counter = 1;
  var points = [];
  while (true) {
    var event = yield csp.take(producers.channelCanvas);
    
    if (counter < 3) { 
      points.push(cutil.getCoordinates(event)); 
      counter++;
    } else {
      points.push(cutil.getCoordinates(event)); 
      cutil.drawTriangle(points, currentColor);
      counter = 1;
      points = [];
    }
  }
}

},{"./canvas-util":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/canvas-util.js","./producers":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/producers.js","./storage":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/storage.js","js-csp":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.js","underscore":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/underscore/underscore.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/producers.js":[function(require,module,exports){
// LIBS
var csp = require("js-csp");

// DOM Elements
var canvas = document.getElementById("canvas");
var resetButton = document.getElementById("reset");
var storeButton = document.getElementById("store");
var openButton = document.getElementById("open");
var colorPicker = document.getElementById("colorPicker");
var selectFile = document.getElementById("selectFile");

// PRODUCER CHANNELS

function noOp() {};

function createChannel(element, eventName) {
  var ch = csp.chan(csp.buffers.dropping(1));
  element.addEventListener(eventName, function(event) {
    csp.putAsync(ch, event, noOp);
  });
  return ch;
}


module.exports = {
  channelResetButton: createChannel(resetButton, "click"),
  channelStoreButton: createChannel(storeButton, "click"),
  channelOpenButton: createChannel(openButton, "click"),
  channelColorPicker: createChannel(colorPicker, "input"),
  channelCanvas: createChannel(canvas, "click"),
  channelSelectFile: createChannel(selectFile, "change")
}
},{"js-csp":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/js-csp/src/csp.js"}],"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/storage.js":[function(require,module,exports){
var _ = require("underscore");

function getDrawingsFromLocalStorage() {
  var currentDrawings = localStorage["drawings"];
  if (currentDrawings === undefined 
    || currentDrawings === null
    || currentDrawings === "null"
    || currentDrawings === ""
    || ! currentDrawings instanceof Array ) {
      return [];
    } else {
      return JSON.parse(currentDrawings);
    }
}

function findDrawingByName(drawings, drawingName) {
  var drawing = _.where(drawings, {name: drawingName});
  return drawing[0];
}

module.exports = {
  getAllDrawingNames: function () {
    var drawings = getDrawingsFromLocalStorage();
    return _.map(drawings, function (drawing) {
      return drawing.name
    })
  },  
  save: function (drawingName, data) {
    var drawings = getDrawingsFromLocalStorage();
    var drawing;
  
    if (drawingName) {
      drawing = findDrawingByName(drawings, drawingName);
      if (drawing) {
        alert('This name is already used!');
      } else {
        drawings.push({name: drawingName, pic: data});
        localStorage["drawings"] = JSON.stringify(drawings);
        alert('Drawing is saved!');      
      }
    } else {
      alert('Specify file name!');
    } 
  },
  find: function (drawingName) {
    var drawings = getDrawingsFromLocalStorage();
    var drawing;
    if (drawingName) {
      drawing = findDrawingByName(drawings, drawingName);
      if (!drawing) {
        alert("Drawing with such name not found!");
        return null;
      } else {
        return drawing.pic;
      }
    } else {
      alert('Select file to open!');
      return null;
    }
  }
}
},{"underscore":"/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/node_modules/underscore/underscore.js"}]},{},["/Users/pltod/Projects/JavaScript/01_MyGithub/hb-nodejs-2014-two/src/index.js"])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL1VzZXJzL3BsdG9kL1Byb2plY3RzL0phdmFTY3JpcHQvMDFfTXlHaXRodWIvaGItbm9kZWpzLTIwMTQtdHdvL25vZGVfbW9kdWxlcy9qcy1jc3Avc3JjL2NzcC5jb3JlLmpzIiwiL1VzZXJzL3BsdG9kL1Byb2plY3RzL0phdmFTY3JpcHQvMDFfTXlHaXRodWIvaGItbm9kZWpzLTIwMTQtdHdvL25vZGVfbW9kdWxlcy9qcy1jc3Avc3JjL2NzcC5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvanMtY3NwL3NyYy9jc3Aub3BlcmF0aW9ucy5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvanMtY3NwL3NyYy9pbXBsL2J1ZmZlcnMuanMiLCIvVXNlcnMvcGx0b2QvUHJvamVjdHMvSmF2YVNjcmlwdC8wMV9NeUdpdGh1Yi9oYi1ub2RlanMtMjAxNC10d28vbm9kZV9tb2R1bGVzL2pzLWNzcC9zcmMvaW1wbC9jaGFubmVscy5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvanMtY3NwL3NyYy9pbXBsL2Rpc3BhdGNoLmpzIiwiL1VzZXJzL3BsdG9kL1Byb2plY3RzL0phdmFTY3JpcHQvMDFfTXlHaXRodWIvaGItbm9kZWpzLTIwMTQtdHdvL25vZGVfbW9kdWxlcy9qcy1jc3Avc3JjL2ltcGwvcHJvY2Vzcy5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvanMtY3NwL3NyYy9pbXBsL3NlbGVjdC5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvanMtY3NwL3NyYy9pbXBsL3RpbWVycy5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9ub2RlX21vZHVsZXMvdW5kZXJzY29yZS91bmRlcnNjb3JlLmpzIiwiL1VzZXJzL3BsdG9kL1Byb2plY3RzL0phdmFTY3JpcHQvMDFfTXlHaXRodWIvaGItbm9kZWpzLTIwMTQtdHdvL3NyYy9jYW52YXMtdXRpbC5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9zcmMvaW5kZXguanMiLCIvVXNlcnMvcGx0b2QvUHJvamVjdHMvSmF2YVNjcmlwdC8wMV9NeUdpdGh1Yi9oYi1ub2RlanMtMjAxNC10d28vc3JjL3Byb2R1Y2Vycy5qcyIsIi9Vc2Vycy9wbHRvZC9Qcm9qZWN0cy9KYXZhU2NyaXB0LzAxX015R2l0aHViL2hiLW5vZGVqcy0yMDE0LXR3by9zcmMvc3RvcmFnZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNubkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdjRDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25HQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIGJ1ZmZlcnMgPSByZXF1aXJlKFwiLi9pbXBsL2J1ZmZlcnNcIik7XG52YXIgY2hhbm5lbHMgPSByZXF1aXJlKFwiLi9pbXBsL2NoYW5uZWxzXCIpO1xudmFyIHNlbGVjdCA9IHJlcXVpcmUoXCIuL2ltcGwvc2VsZWN0XCIpO1xudmFyIHByb2Nlc3MgPSByZXF1aXJlKFwiLi9pbXBsL3Byb2Nlc3NcIik7XG52YXIgdGltZXJzID0gcmVxdWlyZShcIi4vaW1wbC90aW1lcnNcIik7XG5cbmZ1bmN0aW9uIHNwYXduKGdlbiwgcmV0dXJuQ2hhbm5lbCkge1xuICBpZiAocmV0dXJuQ2hhbm5lbCkge1xuICAgIHZhciBjaCA9IGNoYW5uZWxzLmNoYW4oYnVmZmVycy5maXhlZCgxKSk7XG4gICAgKG5ldyBwcm9jZXNzLlByb2Nlc3MoZ2VuLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgcHJvY2Vzcy5wdXRfdGhlbl9jYWxsYmFjayhjaCwgdmFsdWUsIGZ1bmN0aW9uKG9rKSB7XG4gICAgICAgIGNoLmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICB9KSkucnVuKCk7XG4gICAgcmV0dXJuIGNoO1xuICB9IGVsc2Uge1xuICAgIChuZXcgcHJvY2Vzcy5Qcm9jZXNzKGdlbikpLnJ1bigpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59O1xuXG5mdW5jdGlvbiBnbyhmLCBhcmdzLCByZXR1cm5DaGFubmVsKSB7XG4gIHZhciBnZW4gPSBmLmFwcGx5KG51bGwsIGFyZ3MpO1xuICByZXR1cm4gc3Bhd24oZ2VuLCByZXR1cm5DaGFubmVsKTtcbn07XG5cbmZ1bmN0aW9uIGNoYW4oYnVmZmVyT3JOdW1iZXIpIHtcbiAgdmFyIGJ1ZjtcbiAgaWYgKGJ1ZmZlck9yTnVtYmVyID09PSAwKSB7XG4gICAgYnVmZmVyT3JOdW1iZXIgPSBudWxsO1xuICB9XG4gIGlmICh0eXBlb2YgYnVmZmVyT3JOdW1iZXIgPT09IFwibnVtYmVyXCIpIHtcbiAgICBidWYgPSBidWZmZXJzLmZpeGVkKGJ1ZmZlck9yTnVtYmVyKTtcbiAgfSBlbHNlIHtcbiAgICBidWYgPSBidWZmZXJPck51bWJlcjtcbiAgfVxuICByZXR1cm4gY2hhbm5lbHMuY2hhbihidWYpO1xufTtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgYnVmZmVyczoge1xuICAgIGZpeGVkOiBidWZmZXJzLmZpeGVkLFxuICAgIGRyb3BwaW5nOiBidWZmZXJzLmRyb3BwaW5nLFxuICAgIHNsaWRpbmc6IGJ1ZmZlcnMuc2xpZGluZ1xuICB9LFxuXG4gIHNwYXduOiBzcGF3bixcbiAgZ286IGdvLFxuICBjaGFuOiBjaGFuLFxuICBERUZBVUxUOiBzZWxlY3QuREVGQVVMVCxcbiAgQ0xPU0VEOiBjaGFubmVscy5DTE9TRUQsXG5cbiAgcHV0OiBwcm9jZXNzLnB1dCxcbiAgdGFrZTogcHJvY2Vzcy50YWtlLFxuICBzbGVlcDogcHJvY2Vzcy5zbGVlcCxcbiAgYWx0czogcHJvY2Vzcy5hbHRzLFxuICBwdXRBc3luYzogcHJvY2Vzcy5wdXRfdGhlbl9jYWxsYmFjayxcbiAgdGFrZUFzeW5jOiBwcm9jZXNzLnRha2VfdGhlbl9jYWxsYmFjayxcblxuICB0aW1lb3V0OiB0aW1lcnMudGltZW91dFxufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgY3NwID0gcmVxdWlyZShcIi4vY3NwLmNvcmVcIik7XG52YXIgb3BlcmF0aW9ucyA9IHJlcXVpcmUoXCIuL2NzcC5vcGVyYXRpb25zXCIpO1xuXG5jc3Aub3BlcmF0aW9ucyA9IG9wZXJhdGlvbnM7XG5cbm1vZHVsZS5leHBvcnRzID0gY3NwO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBCb3ggPSByZXF1aXJlKFwiLi9pbXBsL2NoYW5uZWxzXCIpLkJveDtcblxudmFyIGNzcCA9IHJlcXVpcmUoXCIuL2NzcC5jb3JlXCIpLFxuICAgIGdvID0gY3NwLmdvLFxuICAgIHRha2UgPSBjc3AudGFrZSxcbiAgICBwdXQgPSBjc3AucHV0LFxuICAgIHRha2VBc3luYyA9IGNzcC50YWtlQXN5bmMsXG4gICAgcHV0QXN5bmMgPSBjc3AucHV0QXN5bmMsXG4gICAgYWx0cyA9IGNzcC5hbHRzLFxuICAgIGNoYW4gPSBjc3AuY2hhbixcbiAgICBDTE9TRUQgPSBjc3AuQ0xPU0VEO1xuXG5cbmZ1bmN0aW9uIG5vT3Aodikge1xufVxuXG5mdW5jdGlvbiBtYXBGcm9tKGYsIGNoKSB7XG4gIHJldHVybiB7XG4gICAgaXNfY2xvc2VkOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBjaC5pc19jbG9zZWQoKTtcbiAgICB9LFxuICAgIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICAgIGNoLmNsb3NlKCk7XG4gICAgfSxcbiAgICBfcHV0OiBmdW5jdGlvbih2YWx1ZSwgaGFuZGxlcikge1xuICAgICAgcmV0dXJuIGNoLl9wdXQodmFsdWUsIGhhbmRsZXIpO1xuICAgIH0sXG4gICAgX3Rha2U6IGZ1bmN0aW9uKGhhbmRsZXIpIHtcbiAgICAgIHZhciByZXN1bHQgPSBjaC5fdGFrZSh7XG4gICAgICAgIGlzX2FjdGl2ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIGhhbmRsZXIuaXNfYWN0aXZlKCk7XG4gICAgICAgIH0sXG4gICAgICAgIGNvbW1pdDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHRha2VfY2IgPSBoYW5kbGVyLmNvbW1pdCgpO1xuICAgICAgICAgIHJldHVybiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRha2VfY2IodmFsdWUgPT09IENMT1NFRCA/IENMT1NFRCA6IGYodmFsdWUpKTtcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gcmVzdWx0LnZhbHVlO1xuICAgICAgICByZXR1cm4gbmV3IEJveCh2YWx1ZSA9PT0gQ0xPU0VEID8gQ0xPU0VEIDogZih2YWx1ZSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG5mdW5jdGlvbiBtYXBJbnRvKGYsIGNoKSB7XG4gIHJldHVybiB7XG4gICAgaXNfY2xvc2VkOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBjaC5pc19jbG9zZWQoKTtcbiAgICB9LFxuICAgIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICAgIGNoLmNsb3NlKCk7XG4gICAgfSxcbiAgICBfcHV0OiBmdW5jdGlvbih2YWx1ZSwgaGFuZGxlcikge1xuICAgICAgcmV0dXJuIGNoLl9wdXQoZih2YWx1ZSksIGhhbmRsZXIpO1xuICAgIH0sXG4gICAgX3Rha2U6IGZ1bmN0aW9uKGhhbmRsZXIpIHtcbiAgICAgIHJldHVybiBjaC5fdGFrZShoYW5kbGVyKTtcbiAgICB9XG4gIH07XG59XG5cbmZ1bmN0aW9uIGZpbHRlckZyb20ocCwgY2gsIGJ1ZmZlck9yTikge1xuICB2YXIgb3V0ID0gY2hhbihidWZmZXJPck4pO1xuICBnbyhmdW5jdGlvbiooKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHZhciB2YWx1ZSA9IHlpZWxkIHRha2UoY2gpO1xuICAgICAgaWYgKHZhbHVlID09PSBDTE9TRUQpIHtcbiAgICAgICAgb3V0LmNsb3NlKCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKHAodmFsdWUpKSB7XG4gICAgICAgIHlpZWxkIHB1dChvdXQsIHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBmaWx0ZXJJbnRvKHAsIGNoKSB7XG4gIHJldHVybiB7XG4gICAgaXNfY2xvc2VkOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBjaC5pc19jbG9zZWQoKTtcbiAgICB9LFxuICAgIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICAgIGNoLmNsb3NlKCk7XG4gICAgfSxcbiAgICBfcHV0OiBmdW5jdGlvbih2YWx1ZSwgaGFuZGxlcikge1xuICAgICAgaWYgKHAodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBjaC5fcHV0KHZhbHVlLCBoYW5kbGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBuZXcgQm94KCFjaC5pc19jbG9zZWQoKSk7XG4gICAgICB9XG4gICAgfSxcbiAgICBfdGFrZTogZnVuY3Rpb24oaGFuZGxlcikge1xuICAgICAgcmV0dXJuIGNoLl90YWtlKGhhbmRsZXIpO1xuICAgIH1cbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlRnJvbShwLCBjaCkge1xuICByZXR1cm4gZmlsdGVyRnJvbShmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiAhcCh2YWx1ZSk7XG4gIH0sIGNoKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlSW50byhwLCBjaCkge1xuICByZXR1cm4gZmlsdGVySW50byhmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiAhcCh2YWx1ZSk7XG4gIH0sIGNoKTtcbn1cblxuZnVuY3Rpb24qIG1hcGNhdChmLCBzcmMsIGRzdCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciB2YWx1ZSA9IHlpZWxkIHRha2Uoc3JjKTtcbiAgICBpZiAodmFsdWUgPT09IENMT1NFRCkge1xuICAgICAgZHN0LmNsb3NlKCk7XG4gICAgICBicmVhaztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHNlcSA9IGYodmFsdWUpO1xuICAgICAgdmFyIGxlbmd0aCA9IHNlcS5sZW5ndGg7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHlpZWxkIHB1dChkc3QsIHNlcVtpXSk7XG4gICAgICB9XG4gICAgICBpZiAoZHN0LmlzX2Nsb3NlZCgpKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBjYXRGcm9tKGYsIGNoLCBidWZmZXJPck4pIHtcbiAgdmFyIG91dCA9IGNoYW4oYnVmZmVyT3JOKTtcbiAgZ28obWFwY2F0LCBbZiwgY2gsIG91dF0pO1xuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBtYXBjYXRJbnRvKGYsIGNoLCBidWZmZXJPck4pIHtcbiAgdmFyIHNyYyA9IGNoYW4oYnVmZmVyT3JOKTtcbiAgZ28obWFwY2F0LCBbZiwgc3JjLCBjaF0pO1xuICByZXR1cm4gc3JjO1xufVxuXG5mdW5jdGlvbiBwaXBlKHNyYywgZHN0LCBrZWVwT3Blbikge1xuICBnbyhmdW5jdGlvbiooKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHZhciB2YWx1ZSA9IHlpZWxkIHRha2Uoc3JjKTtcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIGlmICgha2VlcE9wZW4pIHtcbiAgICAgICAgICBkc3QuY2xvc2UoKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmICghKHlpZWxkIHB1dChkc3QsIHZhbHVlKSkpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGRzdDtcbn1cblxuZnVuY3Rpb24gc3BsaXQocCwgY2gsIHRydWVCdWZmZXJPck4sIGZhbHNlQnVmZmVyT3JOKSB7XG4gIHZhciB0Y2ggPSBjaGFuKHRydWVCdWZmZXJPck4pO1xuICB2YXIgZmNoID0gY2hhbihmYWxzZUJ1ZmZlck9yTik7XG4gIGdvKGZ1bmN0aW9uKigpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIHZhbHVlID0geWllbGQgdGFrZShjaCk7XG4gICAgICBpZiAodmFsdWUgPT09IENMT1NFRCkge1xuICAgICAgICB0Y2guY2xvc2UoKTtcbiAgICAgICAgZmNoLmNsb3NlKCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgeWllbGQgcHV0KHAodmFsdWUpID8gdGNoIDogZmNoLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIFt0Y2gsIGZjaF07XG59XG5cbmZ1bmN0aW9uIHJlZHVjZShmLCBpbml0LCBjaCkge1xuICByZXR1cm4gZ28oZnVuY3Rpb24qKCkge1xuICAgIHZhciByZXN1bHQgPSBpbml0O1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB2YXIgdmFsdWUgPSB5aWVsZCB0YWtlKGNoKTtcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHQgPSBmKHJlc3VsdCwgdmFsdWUpO1xuICAgICAgfVxuICAgIH1cbiAgfSwgW10sIHRydWUpO1xufVxuXG5mdW5jdGlvbiBvbnRvKGNoLCBjb2xsLCBrZWVwT3Blbikge1xuICByZXR1cm4gZ28oZnVuY3Rpb24qKCkge1xuICAgIHZhciBsZW5ndGggPSBjb2xsLmxlbmd0aDtcbiAgICAvLyBGSVg6IFNob3VsZCBiZSBhIGdlbmVyaWMgbG9vcGluZyBpbnRlcmZhY2UgKGZvci4uLmluPylcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB5aWVsZCBwdXQoY2gsIGNvbGxbaV0pO1xuICAgIH1cbiAgICBpZiAoIWtlZXBPcGVuKSB7XG4gICAgICBjaC5jbG9zZSgpO1xuICAgIH1cbiAgfSk7XG59XG5cbi8vIFRPRE86IEJvdW5kZWQ/XG5mdW5jdGlvbiBmcm9tQ29sbChjb2xsKSB7XG4gIHZhciBjaCA9IGNoYW4oY29sbC5sZW5ndGgpO1xuICBvbnRvKGNoLCBjb2xsKTtcbiAgcmV0dXJuIGNoO1xufVxuXG5mdW5jdGlvbiBtYXAoZiwgY2hzLCBidWZmZXJPck4pIHtcbiAgdmFyIG91dCA9IGNoYW4oYnVmZmVyT3JOKTtcbiAgdmFyIGxlbmd0aCA9IGNocy5sZW5ndGg7XG4gIC8vIEFycmF5IGhvbGRpbmcgMSByb3VuZCBvZiB2YWx1ZXNcbiAgdmFyIHZhbHVlcyA9IG5ldyBBcnJheShsZW5ndGgpO1xuICAvLyBUT0RPOiBOb3Qgc3VyZSB3aHkgd2UgbmVlZCBhIHNpemUtMSBidWZmZXIgaGVyZVxuICB2YXIgZGNoYW4gPSBjaGFuKDEpO1xuICAvLyBIb3cgbWFueSBtb3JlIGl0ZW1zIHRoaXMgcm91bmRcbiAgdmFyIGRjb3VudDtcbiAgLy8gcHV0IGNhbGxiYWNrcyBmb3IgZWFjaCBjaGFubmVsXG4gIHZhciBkY2FsbGJhY2tzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICsrKSB7XG4gICAgZGNhbGxiYWNrc1tpXSA9IChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgdmFsdWVzW2ldID0gdmFsdWU7XG4gICAgICAgIGRjb3VudCAtLTtcbiAgICAgICAgaWYgKGRjb3VudCA9PT0gMCkge1xuICAgICAgICAgIHB1dEFzeW5jKGRjaGFuLCB2YWx1ZXMuc2xpY2UoMCksIG5vT3ApO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0oaSkpO1xuICB9XG4gIGdvKGZ1bmN0aW9uKigpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgZGNvdW50ID0gbGVuZ3RoO1xuICAgICAgLy8gV2UgY291bGQganVzdCBsYXVuY2ggbiBnb3JvdXRpbmVzIGhlcmUsIGJ1dCBmb3IgZWZmY2llbmN5IHdlXG4gICAgICAvLyBkb24ndFxuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKyspIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0YWtlQXN5bmMoY2hzW2ldLCBkY2FsbGJhY2tzW2ldKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIC8vIEZJWDogSG1tIHdoeSBjYXRjaGluZyBoZXJlP1xuICAgICAgICAgIGRjb3VudCAtLTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdmFyIHZhbHVlcyA9IHlpZWxkIHRha2UoZGNoYW4pO1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSArKykge1xuICAgICAgICBpZiAodmFsdWVzW2ldID09PSBDTE9TRUQpIHtcbiAgICAgICAgICBvdXQuY2xvc2UoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHlpZWxkIHB1dChvdXQsIGYuYXBwbHkobnVsbCwgdmFsdWVzKSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gbWVyZ2UoY2hzLCBidWZmZXJPck4pIHtcbiAgdmFyIG91dCA9IGNoYW4oYnVmZmVyT3JOKTtcbiAgdmFyIGFjdGl2ZXMgPSBjaHMuc2xpY2UoMCk7XG4gIGdvKGZ1bmN0aW9uKigpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKGFjdGl2ZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdmFyIHIgPSB5aWVsZCBhbHRzKGFjdGl2ZXMpO1xuICAgICAgdmFyIHZhbHVlID0gci52YWx1ZTtcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIC8vIFJlbW92ZSBjbG9zZWQgY2hhbm5lbFxuICAgICAgICB2YXIgaSA9IGFjdGl2ZXMuaW5kZXhPZihyLmNoYW5uZWwpO1xuICAgICAgICBhY3RpdmVzLnNwbGljZShpLCAxKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB5aWVsZCBwdXQob3V0LCB2YWx1ZSk7XG4gICAgfVxuICAgIG91dC5jbG9zZSgpO1xuICB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gaW50byhjb2xsLCBjaCkge1xuICB2YXIgcmVzdWx0ID0gY29sbC5zbGljZSgwKTtcbiAgcmV0dXJuIHJlZHVjZShmdW5jdGlvbihyZXN1bHQsIGl0ZW0pIHtcbiAgICByZXN1bHQucHVzaChpdGVtKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9LCByZXN1bHQsIGNoKTtcbn1cblxuZnVuY3Rpb24gdGFrZU4obiwgY2gsIGJ1ZmZlck9yTikge1xuICB2YXIgb3V0ID0gY2hhbihidWZmZXJPck4pO1xuICBnbyhmdW5jdGlvbiooKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuOyBpICsrKSB7XG4gICAgICB2YXIgdmFsdWUgPSB5aWVsZCB0YWtlKGNoKTtcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgeWllbGQgcHV0KG91dCwgdmFsdWUpO1xuICAgIH1cbiAgICBvdXQuY2xvc2UoKTtcbiAgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbnZhciBOT1RISU5HID0ge307XG5cbmZ1bmN0aW9uIHVuaXF1ZShjaCwgYnVmZmVyT3JOKSB7XG4gIHZhciBvdXQgPSBjaGFuKGJ1ZmZlck9yTik7XG4gIHZhciBsYXN0ID0gTk9USElORztcbiAgZ28oZnVuY3Rpb24qKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB2YXIgdmFsdWUgPSB5aWVsZCB0YWtlKGNoKTtcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKHZhbHVlID09PSBsYXN0KSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGFzdCA9IHZhbHVlO1xuICAgICAgeWllbGQgcHV0KG91dCwgdmFsdWUpO1xuICAgIH1cbiAgICBvdXQuY2xvc2UoKTtcbiAgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIHBhcnRpdGlvbkJ5KGYsIGNoLCBidWZmZXJPck4pIHtcbiAgdmFyIG91dCA9IGNoYW4oYnVmZmVyT3JOKTtcbiAgdmFyIHBhcnQgPSBbXTtcbiAgdmFyIGxhc3QgPSBOT1RISU5HO1xuICBnbyhmdW5jdGlvbiooKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHZhciB2YWx1ZSA9IHlpZWxkIHRha2UoY2gpO1xuICAgICAgaWYgKHZhbHVlID09PSBDTE9TRUQpIHtcbiAgICAgICAgaWYgKHBhcnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHlpZWxkIHB1dChvdXQsIHBhcnQpO1xuICAgICAgICB9XG4gICAgICAgIG91dC5jbG9zZSgpO1xuICAgICAgICBicmVhaztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBuZXdJdGVtID0gZih2YWx1ZSk7XG4gICAgICAgIGlmIChuZXdJdGVtID09PSBsYXN0IHx8IGxhc3QgPT09IE5PVEhJTkcpIHtcbiAgICAgICAgICBwYXJ0LnB1c2godmFsdWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHlpZWxkIHB1dChvdXQsIHBhcnQpO1xuICAgICAgICAgIHBhcnQgPSBbdmFsdWVdO1xuICAgICAgICB9XG4gICAgICAgIGxhc3QgPSBuZXdJdGVtO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIHBhcnRpdGlvbihuLCBjaCwgYnVmZmVyT3JOKSB7XG4gIHZhciBvdXQgPSBjaGFuKGJ1ZmZlck9yTik7XG4gIGdvKGZ1bmN0aW9uKigpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIHBhcnQgPSBuZXcgQXJyYXkobik7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG47IGkrKykge1xuICAgICAgICB2YXIgdmFsdWUgPSB5aWVsZCB0YWtlKGNoKTtcbiAgICAgICAgaWYgKHZhbHVlID09PSBDTE9TRUQpIHtcbiAgICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICAgIHlpZWxkIHB1dChvdXQsIHBhcnQuc2xpY2UoMCwgaSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBvdXQuY2xvc2UoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcGFydFtpXSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgeWllbGQgcHV0KG91dCwgcGFydCk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gRm9yIGNoYW5uZWwgaWRlbnRpZmljYXRpb25cbnZhciBnZW5JZCA9IChmdW5jdGlvbigpIHtcbiAgdmFyIGkgPSAwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgaSArKztcbiAgICByZXR1cm4gXCJcIiArIGk7XG4gIH07XG59KSgpO1xuXG52YXIgSURfQVRUUiA9IFwiX19jc3BfY2hhbm5lbF9pZFwiO1xuXG4vLyBUT0RPOiBEbyB3ZSBuZWVkIHRvIGNoZWNrIHdpdGggaGFzT3duUHJvcGVydHk/XG5mdW5jdGlvbiBsZW4ob2JqKSB7XG4gIHZhciBjb3VudCA9IDA7XG4gIGZvciAodmFyIHAgaW4gb2JqKSB7XG4gICAgY291bnQgKys7XG4gIH1cbiAgcmV0dXJuIGNvdW50O1xufVxuXG5mdW5jdGlvbiBjaGFuSWQoY2gpIHtcbiAgdmFyIGlkID0gY2hbSURfQVRUUl07XG4gIGlmIChpZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgaWQgPSBjaFtJRF9BVFRSXSA9IGdlbklkKCk7XG4gIH1cbiAgcmV0dXJuIGlkO1xufVxuXG52YXIgTXVsdCA9IGZ1bmN0aW9uKGNoKSB7XG4gIHRoaXMudGFwcyA9IHt9O1xuICB0aGlzLmNoID0gY2g7XG59O1xuXG52YXIgVGFwID0gZnVuY3Rpb24oY2hhbm5lbCwga2VlcE9wZW4pIHtcbiAgdGhpcy5jaGFubmVsID0gY2hhbm5lbDtcbiAgdGhpcy5rZWVwT3BlbiA9IGtlZXBPcGVuO1xufTtcblxuTXVsdC5wcm90b3R5cGUubXV4Y2ggPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuY2g7XG59O1xuXG5NdWx0LnByb3RvdHlwZS50YXAgPSBmdW5jdGlvbihjaCwga2VlcE9wZW4pIHtcbiAgdmFyIGlkID0gY2hhbklkKGNoKTtcbiAgdGhpcy50YXBzW2lkXSA9IG5ldyBUYXAoY2gsIGtlZXBPcGVuKTtcbn07XG5cbk11bHQucHJvdG90eXBlLnVudGFwID0gZnVuY3Rpb24oY2gpIHtcbiAgZGVsZXRlIHRoaXMudGFwc1tjaGFuSWQoY2gpXTtcbn07XG5cbk11bHQucHJvdG90eXBlLnVudGFwQWxsID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGFwcyA9IHt9O1xufTtcblxuZnVuY3Rpb24gbXVsdChjaCkge1xuICB2YXIgbSA9IG5ldyBNdWx0KGNoKTtcbiAgdmFyIGRjaGFuID0gY2hhbigxKTtcbiAgdmFyIGRjb3VudDtcbiAgZnVuY3Rpb24gbWFrZURvbmVDYWxsYmFjayh0YXApIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oc3RpbGxPcGVuKSB7XG4gICAgICBkY291bnQgLS07XG4gICAgICBpZiAoZGNvdW50ID09PSAwKSB7XG4gICAgICAgIHB1dEFzeW5jKGRjaGFuLCB0cnVlLCBub09wKTtcbiAgICAgIH1cbiAgICAgIGlmICghc3RpbGxPcGVuKSB7XG4gICAgICAgIG0udW50YXAodGFwLmNoYW5uZWwpO1xuICAgICAgfVxuICAgIH07XG4gIH1cbiAgZ28oZnVuY3Rpb24qKCkge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB2YXIgdmFsdWUgPSB5aWVsZCB0YWtlKGNoKTtcbiAgICAgIHZhciBpZCwgdDtcbiAgICAgIHZhciB0YXBzID0gbS50YXBzO1xuICAgICAgaWYgKHZhbHVlID09PSBDTE9TRUQpIHtcbiAgICAgICAgZm9yIChpZCBpbiB0YXBzKSB7XG4gICAgICAgICAgdCA9IHRhcHNbaWRdO1xuICAgICAgICAgIGlmICghdC5rZWVwT3Blbikge1xuICAgICAgICAgICAgdC5jaGFubmVsLmNsb3NlKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IElzIHRoaXMgbmVjZXNzYXJ5P1xuICAgICAgICBtLnVudGFwQWxsKCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZGNvdW50ID0gbGVuKHRhcHMpO1xuICAgICAgLy8gWFhYOiBUaGlzIGlzIGJlY2F1c2UgcHV0QXN5bmMgY2FuIGFjdHVhbGx5IGNhbGwgYmFja1xuICAgICAgLy8gaW1tZWRpYXRlbHkuIEZpeCB0aGF0XG4gICAgICB2YXIgaW5pdERjb3VudCA9IGRjb3VudDtcbiAgICAgIC8vIFB1dCB2YWx1ZSBvbiB0YXBwaW5nIGNoYW5uZWxzLi4uXG4gICAgICBmb3IgKGlkIGluIHRhcHMpIHtcbiAgICAgICAgdCA9IHRhcHNbaWRdO1xuICAgICAgICBwdXRBc3luYyh0LmNoYW5uZWwsIHZhbHVlLCBtYWtlRG9uZUNhbGxiYWNrKHQpKTtcbiAgICAgIH1cbiAgICAgIC8vIC4uLiB3YWl0aW5nIGZvciBhbGwgcHV0cyB0byBjb21wbGV0ZVxuICAgICAgaWYgKGluaXREY291bnQgPiAwKSB7XG4gICAgICAgIHlpZWxkIHRha2UoZGNoYW4pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiBtO1xufVxuXG5tdWx0LnRhcCA9IGZ1bmN0aW9uIHRhcChtLCBjaCwga2VlcE9wZW4pIHtcbiAgbS50YXAoY2gsIGtlZXBPcGVuKTtcbiAgcmV0dXJuIGNoO1xufTtcblxubXVsdC51bnRhcCA9IGZ1bmN0aW9uIHVudGFwKG0sIGNoKSB7XG4gIG0udW50YXAoY2gpO1xufTtcblxubXVsdC51bnRhcEFsbCA9IGZ1bmN0aW9uIHVudGFwQWxsKG0pIHtcbiAgbS51bnRhcEFsbCgpO1xufTtcblxuZnVuY3Rpb24gY29uc3RhbnRseU51bGwoKSB7XG4gIHJldHVybiBudWxsO1xufVxuXG52YXIgUHViID0gZnVuY3Rpb24oY2gsIHRvcGljRm4sIGJ1ZmZlckZuKSB7XG4gIHRoaXMuY2ggPSBjaDtcbiAgdGhpcy50b3BpY0ZuID0gdG9waWNGbjtcbiAgdGhpcy5idWZmZXJGbiA9IGJ1ZmZlckZuO1xuICB0aGlzLm11bHRzID0ge307XG59O1xuXG5QdWIucHJvdG90eXBlLl9lbnN1cmVNdWx0ID0gZnVuY3Rpb24odG9waWMpIHtcbiAgdmFyIG0gPSB0aGlzLm11bHRzW3RvcGljXTtcbiAgdmFyIGJ1ZmZlckZuID0gdGhpcy5idWZmZXJGbjtcbiAgaWYgKCFtKSB7XG4gICAgbSA9IHRoaXMubXVsdHNbdG9waWNdID0gbXVsdChjaGFuKGJ1ZmZlckZuKHRvcGljKSkpO1xuICB9XG4gIHJldHVybiBtO1xufTtcblxuUHViLnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbih0b3BpYywgY2gsIGtlZXBPcGVuKSB7XG4gIHZhciBtID0gdGhpcy5fZW5zdXJlTXVsdCh0b3BpYyk7XG4gIHJldHVybiBtdWx0LnRhcChtLCBjaCwga2VlcE9wZW4pO1xufTtcblxuUHViLnByb3RvdHlwZS51bnN1YiA9IGZ1bmN0aW9uKHRvcGljLCBjaCkge1xuICB2YXIgbSA9IHRoaXMubXVsdHNbdG9waWNdO1xuICBpZiAobSkge1xuICAgIG11bHQudW50YXAobSwgY2gpO1xuICB9XG59O1xuXG5QdWIucHJvdG90eXBlLnVuc3ViQWxsID0gZnVuY3Rpb24odG9waWMpIHtcbiAgaWYgKHRvcGljID09PSB1bmRlZmluZWQpIHtcbiAgICB0aGlzLm11bHRzID0ge307XG4gIH0gZWxzZSB7XG4gICAgZGVsZXRlIHRoaXMubXVsdHNbdG9waWNdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBwdWIoY2gsIHRvcGljRm4sIGJ1ZmZlckZuKSB7XG4gIGJ1ZmZlckZuID0gYnVmZmVyRm4gfHwgY29uc3RhbnRseU51bGw7XG4gIHZhciBwID0gbmV3IFB1YihjaCwgdG9waWNGbiwgYnVmZmVyRm4pO1xuICBnbyhmdW5jdGlvbiooKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHZhciB2YWx1ZSA9IHlpZWxkIHRha2UoY2gpO1xuICAgICAgdmFyIG11bHRzID0gcC5tdWx0cztcbiAgICAgIHZhciB0b3BpYztcbiAgICAgIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgIGZvciAodG9waWMgaW4gbXVsdHMpIHtcbiAgICAgICAgICBtdWx0c1t0b3BpY10ubXV4Y2goKS5jbG9zZSgpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgLy8gVE9ETzogU29tZWhvdyBlbnN1cmUvZG9jdW1lbnQgdGhhdCB0aGlzIG11c3QgcmV0dXJuIGEgc3RyaW5nXG4gICAgICAvLyAob3RoZXJ3aXNlIHVzZSBwcm9wZXIgKGhhc2gpbWFwcylcbiAgICAgIHRvcGljID0gdG9waWNGbih2YWx1ZSk7XG4gICAgICB2YXIgbSA9IG11bHRzW3RvcGljXTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIHZhciBzdGlsbE9wZW4gPSB5aWVsZCBwdXQobS5tdXhjaCgpLCB2YWx1ZSk7XG4gICAgICAgIGlmICghc3RpbGxPcGVuKSB7XG4gICAgICAgICAgZGVsZXRlIG11bHRzW3RvcGljXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiBwO1xufVxuXG5wdWIuc3ViID0gZnVuY3Rpb24gc3ViKHAsIHRvcGljLCBjaCwga2VlcE9wZW4pIHtcbiAgcmV0dXJuIHAuc3ViKHRvcGljLCBjaCwga2VlcE9wZW4pO1xufTtcblxucHViLnVuc3ViID0gZnVuY3Rpb24gdW5zdWIocCwgdG9waWMsIGNoKSB7XG4gIHAudW5zdWIodG9waWMsIGNoKTtcbn07XG5cbnB1Yi51bnN1YkFsbCA9IGZ1bmN0aW9uIHVuc3ViQWxsKHAsIHRvcGljKSB7XG4gIHAudW5zdWJBbGwodG9waWMpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG1hcEZyb206IG1hcEZyb20sXG4gIG1hcEludG86IG1hcEludG8sXG4gIGZpbHRlckZyb206IGZpbHRlckZyb20sXG4gIGZpbHRlckludG86IGZpbHRlckludG8sXG4gIHJlbW92ZUZyb206IHJlbW92ZUZyb20sXG4gIHJlbW92ZUludG86IHJlbW92ZUludG8sXG4gIG1hcGNhdEZyb206IG1hcGNhdEZyb20sXG4gIG1hcGNhdEludG86IG1hcGNhdEludG8sXG5cbiAgcGlwZTogcGlwZSxcbiAgc3BsaXQ6IHNwbGl0LFxuICByZWR1Y2U6IHJlZHVjZSxcbiAgb250bzogb250byxcbiAgZnJvbUNvbGw6IGZyb21Db2xsLFxuXG4gIG1hcDogbWFwLFxuICBtZXJnZTogbWVyZ2UsXG4gIGludG86IGludG8sXG4gIHRha2U6IHRha2VOLFxuICB1bmlxdWU6IHVuaXF1ZSxcbiAgcGFydGl0aW9uOiBwYXJ0aXRpb24sXG4gIHBhcnRpdGlvbkJ5OiBwYXJ0aXRpb25CeVxufTtcblxuXG4vLyBQb3NzaWJsZSBcImZsdWlkXCIgaW50ZXJmYWNlczpcblxuLy8gdGhyZWFkKFxuLy8gICBbZnJvbUNvbGwsIFsxLCAyLCAzLCA0XV0sXG4vLyAgIFttYXBGcm9tLCBpbmNdLFxuLy8gICBbaW50bywgW11dXG4vLyApXG5cbi8vIHRocmVhZChcbi8vICAgW2Zyb21Db2xsLCBbMSwgMiwgMywgNF1dLFxuLy8gICBbbWFwRnJvbSwgaW5jLCBfXSxcbi8vICAgW2ludG8sIFtdLCBfXVxuLy8gKVxuXG4vLyB3cmFwKClcbi8vICAgLmZyb21Db2xsKFsxLCAyLCAzLCA0XSlcbi8vICAgLm1hcEZyb20oaW5jKVxuLy8gICAuaW50byhbXSlcbi8vICAgLnVud3JhcCgpO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbi8vIFRPRE86IENvbnNpZGVyIEVtcHR5RXJyb3IgJiBGdWxsRXJyb3IgdG8gYXZvaWQgcmVkdW5kYW50IGJvdW5kXG4vLyBjaGVja3MsIHRvIGltcHJvdmUgcGVyZm9ybWFuY2UgKG1heSBuZWVkIGJlbmNobWFya3MpXG5cbmZ1bmN0aW9uIGFjb3B5KHNyYywgc3JjX3N0YXJ0LCBkc3QsIGRzdF9zdGFydCwgbGVuZ3RoKSB7XG4gIHZhciBjb3VudCA9IDA7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKGNvdW50ID49IGxlbmd0aCkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGRzdFtkc3Rfc3RhcnQgKyBjb3VudF0gPSBzcmNbc3JjX3N0YXJ0ICsgY291bnRdO1xuICAgIGNvdW50ICsrO1xuICB9XG59XG5cbnZhciBFTVBUWSA9IHtcbiAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcIltvYmplY3QgRU1QVFldXCI7XG4gIH1cbn07XG5cbnZhciBSaW5nQnVmZmVyID0gZnVuY3Rpb24oaGVhZCwgdGFpbCwgbGVuZ3RoLCBhcnJheSkge1xuICB0aGlzLmxlbmd0aCA9IGxlbmd0aDtcbiAgdGhpcy5hcnJheSA9IGFycmF5O1xuICB0aGlzLmhlYWQgPSBoZWFkO1xuICB0aGlzLnRhaWwgPSB0YWlsO1xufTtcblxuLy8gSW50ZXJuYWwgbWV0aG9kLCBjYWxsZXJzIG11c3QgZG8gYm91bmQgY2hlY2tcblJpbmdCdWZmZXIucHJvdG90eXBlLl91bnNoaWZ0ID0gZnVuY3Rpb24oaXRlbSkge1xuICB2YXIgYXJyYXkgPSB0aGlzLmFycmF5O1xuICB2YXIgaGVhZCA9IHRoaXMuaGVhZDtcbiAgYXJyYXlbaGVhZF0gPSBpdGVtO1xuICB0aGlzLmhlYWQgPSAoaGVhZCArIDEpICUgYXJyYXkubGVuZ3RoO1xuICB0aGlzLmxlbmd0aCArKztcbn07XG5cblJpbmdCdWZmZXIucHJvdG90eXBlLl9yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFycmF5ID0gdGhpcy5hcnJheTtcbiAgdmFyIG5ld19sZW5ndGggPSAyICogYXJyYXkubGVuZ3RoO1xuICB2YXIgbmV3X2FycmF5ID0gbmV3IEFycmF5KG5ld19sZW5ndGgpO1xuICB2YXIgaGVhZCA9IHRoaXMuaGVhZDtcbiAgdmFyIHRhaWwgPSB0aGlzLnRhaWw7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aDtcbiAgaWYgKHRhaWwgPCBoZWFkKSB7XG4gICAgYWNvcHkoYXJyYXksIHRhaWwsIG5ld19hcnJheSwgMCwgbGVuZ3RoKTtcbiAgICB0aGlzLnRhaWwgPSAwO1xuICAgIHRoaXMuaGVhZCA9IGxlbmd0aDtcbiAgICB0aGlzLmFycmF5ID0gbmV3X2FycmF5O1xuICB9IGVsc2UgaWYgKHRhaWwgPiBoZWFkKSB7XG4gICAgYWNvcHkoYXJyYXksIHRhaWwsIG5ld19hcnJheSwgMCwgYXJyYXkubGVuZ3RoIC0gdGFpbCk7XG4gICAgYWNvcHkoYXJyYXksIDAsIG5ld19hcnJheSwgYXJyYXkubGVuZ3RoIC0gdGFpbCwgaGVhZCk7XG4gICAgdGhpcy50YWlsID0gMDtcbiAgICB0aGlzLmhlYWQgPSBsZW5ndGg7XG4gICAgdGhpcy5hcnJheSA9IG5ld19hcnJheTtcbiAgfSBlbHNlIGlmICh0YWlsID09PSBoZWFkKSB7XG4gICAgdGhpcy50YWlsID0gMDtcbiAgICB0aGlzLmhlYWQgPSAwO1xuICAgIHRoaXMuYXJyYXkgPSBuZXdfYXJyYXk7XG4gIH1cbn07XG5cblJpbmdCdWZmZXIucHJvdG90eXBlLnVuYm91bmRlZF91bnNoaWZ0ID0gZnVuY3Rpb24oaXRlbSkge1xuICBpZiAodGhpcy5sZW5ndGggKyAxID09PSB0aGlzLmFycmF5Lmxlbmd0aCkge1xuICAgIHRoaXMuX3Jlc2l6ZSgpO1xuICB9XG4gIHRoaXMuX3Vuc2hpZnQoaXRlbSk7XG59O1xuXG5SaW5nQnVmZmVyLnByb3RvdHlwZS5wb3AgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIEVNUFRZO1xuICB9XG4gIHZhciBhcnJheSA9IHRoaXMuYXJyYXk7XG4gIHZhciB0YWlsID0gdGhpcy50YWlsO1xuICB2YXIgaXRlbSA9IGFycmF5W3RhaWxdO1xuICBhcnJheVt0YWlsXSA9IG51bGw7XG4gIHRoaXMudGFpbCA9ICh0YWlsICsgMSkgJSBhcnJheS5sZW5ndGg7XG4gIHRoaXMubGVuZ3RoIC0tO1xuICByZXR1cm4gaXRlbTtcbn07XG5cblJpbmdCdWZmZXIucHJvdG90eXBlLmNsZWFudXAgPSBmdW5jdGlvbihwcmVkaWNhdGUpIHtcbiAgdmFyIGxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSB0aGlzLnBvcCgpO1xuICAgIGlmIChwcmVkaWNhdGUoaXRlbSkpIHtcbiAgICAgIHRoaXMuX3Vuc2hpZnQoaXRlbSk7XG4gICAgfVxuICB9XG59O1xuXG5cbnZhciBGaXhlZEJ1ZmZlciA9IGZ1bmN0aW9uKGJ1ZiwgIG4pIHtcbiAgdGhpcy5idWYgPSBidWY7XG4gIHRoaXMubiA9IG47XG59O1xuXG5GaXhlZEJ1ZmZlci5wcm90b3R5cGUuaXNfZnVsbCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5idWYubGVuZ3RoID09IHRoaXMubjtcbn07XG5cbkZpeGVkQnVmZmVyLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYnVmLnBvcCgpO1xufTtcblxuRml4ZWRCdWZmZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgaWYgKHRoaXMuaXNfZnVsbCgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgYWRkIHRvIGEgZnVsbCBidWZmZXJcIik7XG4gIH1cbiAgdGhpcy5idWYuX3Vuc2hpZnQoaXRlbSk7XG59O1xuXG5GaXhlZEJ1ZmZlci5wcm90b3R5cGUuY291bnQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYnVmLmxlbmd0aDtcbn07XG5cblxudmFyIERyb3BwaW5nQnVmZmVyID0gZnVuY3Rpb24oYnVmLCBuKSB7XG4gIHRoaXMuYnVmID0gYnVmO1xuICB0aGlzLm4gPSBuO1xufTtcblxuRHJvcHBpbmdCdWZmZXIucHJvdG90eXBlLmlzX2Z1bGwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuRHJvcHBpbmdCdWZmZXIucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5idWYucG9wKCk7XG59O1xuXG5Ecm9wcGluZ0J1ZmZlci5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oaXRlbSkge1xuICBpZiAodGhpcy5idWYubGVuZ3RoIDwgdGhpcy5uKSB7XG4gICAgdGhpcy5idWYuX3Vuc2hpZnQoaXRlbSk7XG4gIH1cbn07XG5cbkRyb3BwaW5nQnVmZmVyLnByb3RvdHlwZS5jb3VudCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5idWYubGVuZ3RoO1xufTtcblxuXG52YXIgU2xpZGluZ0J1ZmZlciA9IGZ1bmN0aW9uKGJ1Ziwgbikge1xuICB0aGlzLmJ1ZiA9IGJ1ZjtcbiAgdGhpcy5uID0gbjtcbn07XG5cblNsaWRpbmdCdWZmZXIucHJvdG90eXBlLmlzX2Z1bGwgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuU2xpZGluZ0J1ZmZlci5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmJ1Zi5wb3AoKTtcbn07XG5cblNsaWRpbmdCdWZmZXIucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgaWYgKHRoaXMuYnVmLmxlbmd0aCA9PT0gdGhpcy5uKSB7XG4gICAgdGhpcy5idWYucG9wKCk7XG4gIH1cbiAgdGhpcy5idWYuX3Vuc2hpZnQoaXRlbSk7XG59O1xuXG5TbGlkaW5nQnVmZmVyLnByb3RvdHlwZS5jb3VudCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5idWYubGVuZ3RoO1xufTtcblxuXG52YXIgcmluZyA9IGV4cG9ydHMucmluZyA9IGZ1bmN0aW9uIHJpbmdfYnVmZmVyKG4pIHtcbiAgcmV0dXJuIG5ldyBSaW5nQnVmZmVyKDAsIDAsIDAsIG5ldyBBcnJheShuKSk7XG59O1xuXG5leHBvcnRzLmZpeGVkID0gZnVuY3Rpb24gZml4ZWRfYnVmZmVyKG4pIHtcbiAgcmV0dXJuIG5ldyBGaXhlZEJ1ZmZlcihyaW5nKG4pLCBuKTtcbn07XG5cbmV4cG9ydHMuZHJvcHBpbmcgPSBmdW5jdGlvbiBkcm9wcGluZ19idWZmZXIobikge1xuICByZXR1cm4gbmV3IERyb3BwaW5nQnVmZmVyKHJpbmcobiksIG4pO1xufTtcblxuZXhwb3J0cy5zbGlkaW5nID0gZnVuY3Rpb24gc2xpZGluZ19idWZmZXIobikge1xuICByZXR1cm4gbmV3IFNsaWRpbmdCdWZmZXIocmluZyhuKSwgbik7XG59O1xuXG5leHBvcnRzLkVNUFRZID0gRU1QVFk7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIGJ1ZmZlcnMgPSByZXF1aXJlKFwiLi9idWZmZXJzXCIpO1xudmFyIGRpc3BhdGNoID0gcmVxdWlyZShcIi4vZGlzcGF0Y2hcIik7XG5cbnZhciBNQVhfRElSVFkgPSA2NDtcbnZhciBNQVhfUVVFVUVfU0laRSA9IDEwMjQ7XG5cbnZhciBDTE9TRUQgPSBudWxsO1xuXG52YXIgQm94ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xufTtcblxudmFyIFB1dEJveCA9IGZ1bmN0aW9uKGhhbmRsZXIsIHZhbHVlKSB7XG4gIHRoaXMuaGFuZGxlciA9IGhhbmRsZXI7XG4gIHRoaXMudmFsdWUgPSB2YWx1ZTtcbn07XG5cbnZhciBDaGFubmVsID0gZnVuY3Rpb24odGFrZXMsIHB1dHMsIGJ1Zikge1xuICB0aGlzLmJ1ZiA9IGJ1ZjtcbiAgdGhpcy50YWtlcyA9IHRha2VzO1xuICB0aGlzLnB1dHMgPSBwdXRzO1xuXG4gIHRoaXMuZGlydHlfdGFrZXMgPSAwO1xuICB0aGlzLmRpcnR5X3B1dHMgPSAwO1xuICB0aGlzLmNsb3NlZCA9IGZhbHNlO1xufTtcblxuQ2hhbm5lbC5wcm90b3R5cGUuX3B1dCA9IGZ1bmN0aW9uKHZhbHVlLCBoYW5kbGVyKSB7XG4gIGlmICh2YWx1ZSA9PT0gQ0xPU0VEKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHB1dCBDTE9TRUQgb24gYSBjaGFubmVsLlwiKTtcbiAgfVxuXG4gIGlmICh0aGlzLmNsb3NlZCB8fCAhaGFuZGxlci5pc19hY3RpdmUoKSkge1xuICAgIHJldHVybiBuZXcgQm94KCF0aGlzLmNsb3NlZCk7XG4gIH1cblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciB0YWtlciA9IHRoaXMudGFrZXMucG9wKCk7XG4gICAgaWYgKHRha2VyICE9PSBidWZmZXJzLkVNUFRZKSB7XG4gICAgICBpZiAodGFrZXIuaXNfYWN0aXZlKCkpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gdGFrZXIuY29tbWl0KCk7XG4gICAgICAgIGhhbmRsZXIuY29tbWl0KCk7XG4gICAgICAgIGRpc3BhdGNoLnJ1bihmdW5jdGlvbigpIHtcbiAgICAgICAgICBjYWxsYmFjayh2YWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmV3IEJveCh0cnVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5idWYgJiYgIXRoaXMuYnVmLmlzX2Z1bGwoKSkge1xuICAgICAgICBoYW5kbGVyLmNvbW1pdCgpO1xuICAgICAgICB0aGlzLmJ1Zi5hZGQodmFsdWUpO1xuICAgICAgICByZXR1cm4gbmV3IEJveCh0cnVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLmRpcnR5X3B1dHMgPiBNQVhfRElSVFkpIHtcbiAgICAgICAgICB0aGlzLnB1dHMuY2xlYW51cChmdW5jdGlvbihwdXR0ZXIpIHtcbiAgICAgICAgICAgIHJldHVybiBwdXR0ZXIuaGFuZGxlci5pc19hY3RpdmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aGlzLmRpcnR5X3B1dHMgPSAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZGlydHlfcHV0cyArKztcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5wdXRzLmxlbmd0aCA+PSBNQVhfUVVFVUVfU0laRSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIG1vcmUgdGhhbiBcIiArIE1BWF9RVUVVRV9TSVpFICsgXCIgcGVuZGluZyBwdXRzIGFyZSBhbGxvd2VkIG9uIGEgc2luZ2xlIGNoYW5uZWwuXCIpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucHV0cy51bmJvdW5kZWRfdW5zaGlmdChuZXcgUHV0Qm94KGhhbmRsZXIsIHZhbHVlKSk7XG4gICAgICB9XG4gICAgfVxuICAgIGJyZWFrO1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59O1xuXG5DaGFubmVsLnByb3RvdHlwZS5fdGFrZSA9IGZ1bmN0aW9uKGhhbmRsZXIpIHtcbiAgaWYgKCFoYW5kbGVyLmlzX2FjdGl2ZSgpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICB2YXIgcHV0dGVyLCBwdXRfaGFuZGxlciwgY2FsbGJhY2s7XG5cbiAgaWYgKHRoaXMuYnVmICYmIHRoaXMuYnVmLmNvdW50KCkgPiAwKSB7XG4gICAgaGFuZGxlci5jb21taXQoKTtcbiAgICB2YXIgdmFsdWUgPSB0aGlzLmJ1Zi5yZW1vdmUoKTtcbiAgICAvLyBXZSBuZWVkIHRvIGNoZWNrIHBlbmRpbmcgcHV0cyBoZXJlLCBvdGhlciB3aXNlIHRoZXkgd29uJ3RcbiAgICAvLyBiZSBhYmxlIHRvIHByb2NlZWQgdW50aWwgdGhlaXIgbnVtYmVyIHJlYWNoZXMgTUFYX0RJUlRZXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHB1dHRlciA9IHRoaXMucHV0cy5wb3AoKTtcbiAgICAgIGlmIChwdXR0ZXIgIT09IGJ1ZmZlcnMuRU1QVFkpIHtcbiAgICAgICAgcHV0X2hhbmRsZXIgPSBwdXR0ZXIuaGFuZGxlcjtcbiAgICAgICAgaWYgKHB1dF9oYW5kbGVyLmlzX2FjdGl2ZSgpKSB7XG4gICAgICAgICAgY2FsbGJhY2sgPSBwdXRfaGFuZGxlci5jb21taXQoKTtcbiAgICAgICAgICBkaXNwYXRjaC5ydW4oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBjYWxsYmFjayh0cnVlKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aGlzLmJ1Zi5hZGQocHV0dGVyLnZhbHVlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBuZXcgQm94KHZhbHVlKTtcbiAgfVxuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgcHV0dGVyID0gdGhpcy5wdXRzLnBvcCgpO1xuICAgIGlmIChwdXR0ZXIgIT09IGJ1ZmZlcnMuRU1QVFkpIHtcbiAgICAgIHB1dF9oYW5kbGVyID0gcHV0dGVyLmhhbmRsZXI7XG4gICAgICBpZiAocHV0X2hhbmRsZXIuaXNfYWN0aXZlKCkpIHtcbiAgICAgICAgaGFuZGxlci5jb21taXQoKTtcbiAgICAgICAgY2FsbGJhY2sgPSBwdXRfaGFuZGxlci5jb21taXQoKTtcbiAgICAgICAgZGlzcGF0Y2gucnVuKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHRydWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5ldyBCb3gocHV0dGVyLnZhbHVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5jbG9zZWQpIHtcbiAgICAgICAgaGFuZGxlci5jb21taXQoKTtcbiAgICAgICAgcmV0dXJuIG5ldyBCb3goQ0xPU0VEKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLmRpcnR5X3Rha2VzID4gTUFYX0RJUlRZKSB7XG4gICAgICAgICAgdGhpcy50YWtlcy5jbGVhbnVwKGZ1bmN0aW9uKGhhbmRsZXIpIHtcbiAgICAgICAgICAgIHJldHVybiBoYW5kbGVyLmlzX2FjdGl2ZSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRoaXMuZGlydHlfdGFrZXMgPSAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZGlydHlfdGFrZXMgKys7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMudGFrZXMubGVuZ3RoID49IE1BWF9RVUVVRV9TSVpFKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gbW9yZSB0aGFuIFwiICsgTUFYX1FVRVVFX1NJWkUgKyBcIiBwZW5kaW5nIHRha2VzIGFyZSBhbGxvd2VkIG9uIGEgc2luZ2xlIGNoYW5uZWwuXCIpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGFrZXMudW5ib3VuZGVkX3Vuc2hpZnQoaGFuZGxlcik7XG4gICAgICB9XG4gICAgfVxuICAgIGJyZWFrO1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59O1xuXG5DaGFubmVsLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5jbG9zZWQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciB0YWtlciA9IHRoaXMudGFrZXMucG9wKCk7XG4gICAgaWYgKHRha2VyID09PSBidWZmZXJzLkVNUFRZKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKHRha2VyLmlzX2FjdGl2ZSgpKSB7XG4gICAgICB2YXIgY2FsbGJhY2sgPSB0YWtlci5jb21taXQoKTtcbiAgICAgIGRpc3BhdGNoLnJ1bihmdW5jdGlvbigpIHtcbiAgICAgICAgY2FsbGJhY2soQ0xPU0VEKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICAvLyBUT0RPOiBUZXN0c1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciBwdXR0ZXIgPSB0aGlzLnB1dHMucG9wKCk7XG4gICAgaWYgKHB1dHRlciA9PT0gYnVmZmVycy5FTVBUWSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChwdXR0ZXIuaGFuZGxlci5pc19hY3RpdmUoKSkge1xuICAgICAgdmFyIHB1dF9jYWxsYmFjayA9IHB1dHRlci5oYW5kbGVyLmNvbW1pdCgpO1xuICAgICAgZGlzcGF0Y2gucnVuKGZ1bmN0aW9uKCkge1xuICAgICAgICBwdXRfY2FsbGJhY2soZmFsc2UpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG59O1xuXG5cbkNoYW5uZWwucHJvdG90eXBlLmlzX2Nsb3NlZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5jbG9zZWQ7XG59O1xuXG5cbmV4cG9ydHMuY2hhbiA9IGZ1bmN0aW9uKGJ1Zikge1xuICByZXR1cm4gbmV3IENoYW5uZWwoYnVmZmVycy5yaW5nKDMyKSwgYnVmZmVycy5yaW5nKDMyKSwgYnVmKTtcbn07XG5cbmV4cG9ydHMuQm94ID0gQm94O1xuXG5leHBvcnRzLkNMT1NFRCA9IENMT1NFRDtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG4vLyBUT0RPOiBVc2UgcHJvY2Vzcy5uZXh0VGljayBpZiBpdCdzIGF2YWlsYWJsZSBzaW5jZSBpdCdzIG1vcmVcbi8vIGVmZmljaWVudFxuLy8gaHR0cDovL2hvd3Rvbm9kZS5vcmcvdW5kZXJzdGFuZGluZy1wcm9jZXNzLW5leHQtdGlja1xuLy8gTWF5YmUgd2UgZG9uJ3QgZXZlbiBuZWVkIHRvIHF1ZXVlIG91cnNlbHZlcyBpbiB0aGF0IGNhc2U/XG5cbi8vIFhYWDogQnV0IGh0dHA6Ly9ibG9nLm5vZGVqcy5vcmcvMjAxMy8wMy8xMS9ub2RlLXYwLTEwLTAtc3RhYmxlL1xuLy8gTG9va3MgbGlrZSBpdCB3aWxsIGJsb3cgdXAgdGhlIHN0YWNrIChvciBpcyB0aGF0IGp1c3QgYWJvdXRcbi8vIHByZS1lbXB0aW5nIElPIChidXQgdGhhdCdzIGFscmVhZHkgYmFkIGVub3VnaCBJTU8pPylcblxuLy8gTG9va3MgbGlrZVxuLy8gaHR0cDovL25vZGVqcy5vcmcvYXBpL3Byb2Nlc3MuaHRtbCNwcm9jZXNzX3Byb2Nlc3NfbmV4dHRpY2tfY2FsbGJhY2tcbi8vIGlzIHRoZSBlcXVpdmFsZW50IG9mIG91ciBUQVNLX0JBVENIX1NJWkVcblxudmFyIGJ1ZmZlcnMgPSByZXF1aXJlKFwiLi9idWZmZXJzXCIpO1xuXG52YXIgVEFTS19CQVRDSF9TSVpFID0gMTAyNDtcblxudmFyIHRhc2tzID0gYnVmZmVycy5yaW5nKDMyKTtcbnZhciBydW5uaW5nID0gZmFsc2U7XG52YXIgcXVldWVkID0gZmFsc2U7XG5cbnZhciBxdWV1ZV9kaXNwYXRjaGVyO1xuXG5mdW5jdGlvbiBwcm9jZXNzX21lc3NhZ2VzKCkge1xuICBydW5uaW5nID0gdHJ1ZTtcbiAgcXVldWVkID0gZmFsc2U7XG4gIHZhciBjb3VudCA9IDA7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdmFyIHRhc2sgPSB0YXNrcy5wb3AoKTtcbiAgICBpZiAodGFzayA9PT0gYnVmZmVycy5FTVBUWSkge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIC8vIFRPRE86IERvbid0IHdlIG5lZWQgYSB0cnkvZmluYWxseSBoZXJlP1xuICAgIHRhc2soKTtcbiAgICBpZiAoY291bnQgPj0gVEFTS19CQVRDSF9TSVpFKSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY291bnQgKys7XG4gIH1cbiAgcnVubmluZyA9IGZhbHNlO1xuICBpZiAodGFza3MubGVuZ3RoID4gMCkge1xuICAgIHF1ZXVlX2Rpc3BhdGNoZXIoKTtcbiAgfVxufVxuXG5pZiAodHlwZW9mIE1lc3NhZ2VDaGFubmVsICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gIHZhciBtZXNzYWdlX2NoYW5uZWwgPSBuZXcgTWVzc2FnZUNoYW5uZWwoKTtcbiAgbWVzc2FnZV9jaGFubmVsLnBvcnQxLm9ubWVzc2FnZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBwcm9jZXNzX21lc3NhZ2VzKCk7XG4gIH07XG4gIHF1ZXVlX2Rpc3BhdGNoZXIgPSBmdW5jdGlvbigpICB7XG4gICAgaWYgKCEocXVldWVkICYmIHJ1bm5pbmcpKSB7XG4gICAgICBxdWV1ZWQgPSB0cnVlO1xuICAgICAgbWVzc2FnZV9jaGFubmVsLnBvcnQyLnBvc3RNZXNzYWdlKDApO1xuICAgIH1cbiAgfTtcbn0gZWxzZSBpZiAodHlwZW9mIHNldEltbWVkaWF0ZSAhPT0gXCJ1bmRlZmluZWRcIikge1xuICBxdWV1ZV9kaXNwYXRjaGVyID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCEocXVldWVkICYmIHJ1bm5pbmcpKSB7XG4gICAgICBxdWV1ZWQgPSB0cnVlO1xuICAgICAgc2V0SW1tZWRpYXRlKHByb2Nlc3NfbWVzc2FnZXMpO1xuICAgIH1cbiAgfTtcbn0gZWxzZSB7XG4gIHF1ZXVlX2Rpc3BhdGNoZXIgPSBmdW5jdGlvbigpIHtcbiAgICBpZiAoIShxdWV1ZWQgJiYgcnVubmluZykpIHtcbiAgICAgIHF1ZXVlZCA9IHRydWU7XG4gICAgICBzZXRUaW1lb3V0KHByb2Nlc3NfbWVzc2FnZXMsIDApO1xuICAgIH1cbiAgfTtcbn1cblxuZXhwb3J0cy5ydW4gPSBmdW5jdGlvbiAoZikge1xuICB0YXNrcy51bmJvdW5kZWRfdW5zaGlmdChmKTtcbiAgcXVldWVfZGlzcGF0Y2hlcigpO1xufTtcblxuZXhwb3J0cy5xdWV1ZV9kZWxheSA9IGZ1bmN0aW9uKGYsIGRlbGF5KSB7XG4gIHNldFRpbWVvdXQoZiwgZGVsYXkpO1xufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgZGlzcGF0Y2ggPSByZXF1aXJlKFwiLi9kaXNwYXRjaFwiKTtcbnZhciBzZWxlY3QgPSByZXF1aXJlKFwiLi9zZWxlY3RcIik7XG5cbnZhciBGbkhhbmRsZXIgPSBmdW5jdGlvbihmKSB7XG4gIHRoaXMuZiA9IGY7XG59O1xuXG5GbkhhbmRsZXIucHJvdG90eXBlLmlzX2FjdGl2ZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkZuSGFuZGxlci5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmY7XG59O1xuXG5mdW5jdGlvbiBwdXRfdGhlbl9jYWxsYmFjayhjaGFubmVsLCB2YWx1ZSwgY2FsbGJhY2spIHtcbiAgdmFyIHJlc3VsdCA9IGNoYW5uZWwuX3B1dCh2YWx1ZSwgbmV3IEZuSGFuZGxlcihjYWxsYmFjaykpO1xuICBpZiAocmVzdWx0KSB7XG4gICAgY2FsbGJhY2socmVzdWx0LnZhbHVlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0YWtlX3RoZW5fY2FsbGJhY2soY2hhbm5lbCwgY2FsbGJhY2spIHtcbiAgdmFyIHJlc3VsdCA9IGNoYW5uZWwuX3Rha2UobmV3IEZuSGFuZGxlcihjYWxsYmFjaykpO1xuICBpZiAocmVzdWx0KSB7XG4gICAgY2FsbGJhY2socmVzdWx0LnZhbHVlKTtcbiAgfVxufVxuXG52YXIgUHJvY2VzcyA9IGZ1bmN0aW9uKGdlbiwgb25GaW5pc2gpIHtcbiAgdGhpcy5nZW4gPSBnZW47XG4gIHRoaXMuZmluaXNoZWQgPSBmYWxzZTtcbiAgdGhpcy5vbkZpbmlzaCA9IG9uRmluaXNoO1xufTtcblxudmFyIEluc3RydWN0aW9uID0gZnVuY3Rpb24ob3AsIGRhdGEpIHtcbiAgdGhpcy5vcCA9IG9wO1xuICB0aGlzLmRhdGEgPSBkYXRhO1xufTtcblxudmFyIFRBS0UgPSBcInRha2VcIjtcbnZhciBQVVQgPSBcInB1dFwiO1xudmFyIFNMRUVQID0gXCJzbGVlcFwiO1xudmFyIEFMVFMgPSBcImFsdHNcIjtcblxuLy8gVE9ETyBGSVggWFhYOiBUaGlzIGlzIGEgKHByb2JhYmx5KSB0ZW1wb3JhcnkgaGFjayB0byBhdm9pZCBibG93aW5nXG4vLyB1cCB0aGUgc3RhY2ssIGJ1dCBpdCBtZWFucyBkb3VibGUgcXVldWVpbmcgd2hlbiB0aGUgdmFsdWUgaXMgbm90XG4vLyBpbW1lZGlhdGVseSBhdmFpbGFibGVcblByb2Nlc3MucHJvdG90eXBlLl9jb250aW51ZSA9IGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgZGlzcGF0Y2gucnVuKGZ1bmN0aW9uKCkge1xuICAgIHNlbGYucnVuKHJlc3BvbnNlKTtcbiAgfSk7XG59O1xuXG5Qcm9jZXNzLnByb3RvdHlwZS5fZG9uZSA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIGlmICghdGhpcy5maW5pc2hlZCkge1xuICAgIHRoaXMuZmluaXNoZWQgPSB0cnVlO1xuICAgIHZhciBvbkZpbmlzaCA9IHRoaXMub25GaW5pc2g7XG4gICAgaWYgKHR5cGVvZiBvbkZpbmlzaCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBkaXNwYXRjaC5ydW4oZnVuY3Rpb24oKSB7XG4gICAgICAgIG9uRmluaXNoKHZhbHVlKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufTtcblxuUHJvY2Vzcy5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgaWYgKHRoaXMuZmluaXNoZWQpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUT0RPOiBTaG91bGRuJ3Qgd2UgKG9wdGlvbmFsbHkpIHN0b3AgZXJyb3IgcHJvcGFnYXRpb24gaGVyZSAoYW5kXG4gIC8vIHNpZ25hbCB0aGUgZXJyb3IgdGhyb3VnaCBhIGNoYW5uZWwgb3Igc29tZXRoaW5nKT8gT3RoZXJ3aXNlIHRoZVxuICAvLyB1bmNhdWdodCBleGNlcHRpb24gd2lsbCBjcmFzaCBzb21lIHJ1bnRpbWVzIChlLmcuIE5vZGUpXG4gIHZhciBpdGVyID0gdGhpcy5nZW4ubmV4dChyZXNwb25zZSk7XG4gIGlmIChpdGVyLmRvbmUpIHtcbiAgICB0aGlzLl9kb25lKGl0ZXIudmFsdWUpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBpbnMgPSBpdGVyLnZhbHVlO1xuXG4gIGlmIChpbnMgaW5zdGFuY2VvZiBJbnN0cnVjdGlvbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzd2l0Y2ggKGlucy5vcCkge1xuICAgIGNhc2UgUFVUOlxuICAgICAgdmFyIGRhdGEgPSBpbnMuZGF0YTtcbiAgICAgIHB1dF90aGVuX2NhbGxiYWNrKGRhdGEuY2hhbm5lbCwgZGF0YS52YWx1ZSwgZnVuY3Rpb24ob2spIHtcbiAgICAgICAgc2VsZi5fY29udGludWUob2spO1xuICAgICAgfSk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgVEFLRTpcbiAgICAgIHZhciBjaGFubmVsID0gaW5zLmRhdGE7XG4gICAgICB0YWtlX3RoZW5fY2FsbGJhY2soY2hhbm5lbCwgZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgc2VsZi5fY29udGludWUodmFsdWUpO1xuICAgICAgfSk7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgU0xFRVA6XG4gICAgICB2YXIgbXNlY3MgPSBpbnMuZGF0YTtcbiAgICAgIGRpc3BhdGNoLnF1ZXVlX2RlbGF5KGZ1bmN0aW9uKCkge1xuICAgICAgICBzZWxmLnJ1bihudWxsKTtcbiAgICAgIH0sIG1zZWNzKTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSBBTFRTOlxuICAgICAgc2VsZWN0LmRvX2FsdHMoaW5zLmRhdGEub3BlcmF0aW9ucywgZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgICAgIHNlbGYuX2NvbnRpbnVlKHJlc3VsdCk7XG4gICAgICB9LCBpbnMuZGF0YS5vcHRpb25zKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aGlzLl9jb250aW51ZShpbnMpO1xuICB9XG59O1xuXG5mdW5jdGlvbiB0YWtlKGNoYW5uZWwpIHtcbiAgcmV0dXJuIG5ldyBJbnN0cnVjdGlvbihUQUtFLCBjaGFubmVsKTtcbn1cblxuZnVuY3Rpb24gcHV0KGNoYW5uZWwsIHZhbHVlKSB7XG4gIHJldHVybiBuZXcgSW5zdHJ1Y3Rpb24oUFVULCB7XG4gICAgY2hhbm5lbDogY2hhbm5lbCxcbiAgICB2YWx1ZTogdmFsdWVcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHNsZWVwKG1zZWNzKSB7XG4gIHJldHVybiBuZXcgSW5zdHJ1Y3Rpb24oU0xFRVAsIG1zZWNzKTtcbn1cblxuZnVuY3Rpb24gYWx0cyhvcGVyYXRpb25zLCBvcHRpb25zKSB7XG4gIHJldHVybiBuZXcgSW5zdHJ1Y3Rpb24oQUxUUywge1xuICAgIG9wZXJhdGlvbnM6IG9wZXJhdGlvbnMsXG4gICAgb3B0aW9uczogb3B0aW9uc1xuICB9KTtcbn1cblxuZXhwb3J0cy5wdXRfdGhlbl9jYWxsYmFjayA9IHB1dF90aGVuX2NhbGxiYWNrO1xuZXhwb3J0cy50YWtlX3RoZW5fY2FsbGJhY2sgPSB0YWtlX3RoZW5fY2FsbGJhY2s7XG5leHBvcnRzLnB1dCA9IHB1dDtcbmV4cG9ydHMudGFrZSA9IHRha2U7XG5leHBvcnRzLnNsZWVwID0gc2xlZXA7XG5leHBvcnRzLmFsdHMgPSBhbHRzO1xuXG5leHBvcnRzLlByb2Nlc3MgPSBQcm9jZXNzO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBCb3ggPSByZXF1aXJlKFwiLi9jaGFubmVsc1wiKS5Cb3g7XG5cbnZhciBBbHRIYW5kbGVyID0gZnVuY3Rpb24oZmxhZywgZikge1xuICB0aGlzLmYgPSBmO1xuICB0aGlzLmZsYWcgPSBmbGFnO1xufTtcblxuQWx0SGFuZGxlci5wcm90b3R5cGUuaXNfYWN0aXZlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmZsYWcudmFsdWU7XG59O1xuXG5BbHRIYW5kbGVyLnByb3RvdHlwZS5jb21taXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mbGFnLnZhbHVlID0gZmFsc2U7XG4gIHJldHVybiB0aGlzLmY7XG59O1xuXG52YXIgQWx0UmVzdWx0ID0gZnVuY3Rpb24odmFsdWUsIGNoYW5uZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmNoYW5uZWwgPSBjaGFubmVsO1xufTtcblxuZnVuY3Rpb24gcmFuZF9pbnQobikge1xuICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKG4gKyAxKSk7XG59XG5cbmZ1bmN0aW9uIHJhbmRvbV9hcnJheShuKSB7XG4gIHZhciBhID0gbmV3IEFycmF5KG4pO1xuICB2YXIgaTtcbiAgZm9yIChpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGFbaV0gPSAwO1xuICB9XG4gIGZvciAoaSA9IDE7IGkgPCBuOyBpKyspIHtcbiAgICB2YXIgaiA9IHJhbmRfaW50KGkpO1xuICAgIGFbaV0gPSBhW2pdO1xuICAgIGFbal0gPSBpO1xuICB9XG4gIHJldHVybiBhO1xufVxuXG52YXIgaGFzT3duUHJvcGVydHkgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuXG52YXIgREVGQVVMVCA9IHtcbiAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcIltvYmplY3QgREVGQVVMVF1cIjtcbiAgfVxufTtcblxuLy8gVE9ETzogQWNjZXB0IGEgcHJpb3JpdHkgZnVuY3Rpb24gb3Igc29tZXRoaW5nXG5leHBvcnRzLmRvX2FsdHMgPSBmdW5jdGlvbihvcGVyYXRpb25zLCBjYWxsYmFjaywgb3B0aW9ucykge1xuICB2YXIgbGVuZ3RoID0gb3BlcmF0aW9ucy5sZW5ndGg7XG4gIC8vIFhYWCBIbW1cbiAgaWYgKGxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkVtcHR5IGFsdCBsaXN0XCIpO1xuICB9XG5cbiAgdmFyIHByaW9yaXR5ID0gKG9wdGlvbnMgJiYgb3B0aW9ucy5wcmlvcml0eSkgPyB0cnVlIDogZmFsc2U7XG4gIGlmICghcHJpb3JpdHkpIHtcbiAgICB2YXIgaW5kZXhlcyA9IHJhbmRvbV9hcnJheShsZW5ndGgpO1xuICB9XG5cbiAgdmFyIGZsYWcgPSBuZXcgQm94KHRydWUpO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb3BlcmF0aW9uID0gb3BlcmF0aW9uc1twcmlvcml0eSA/IGkgOiBpbmRleGVzW2ldXTtcbiAgICB2YXIgcG9ydCwgcmVzdWx0O1xuICAgIC8vIFhYWCBIbW1cbiAgICBpZiAob3BlcmF0aW9uIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHZhciB2YWx1ZSA9IG9wZXJhdGlvblsxXTtcbiAgICAgIHBvcnQgPSBvcGVyYXRpb25bMF07XG4gICAgICByZXN1bHQgPSBwb3J0Ll9wdXQodmFsdWUsIChmdW5jdGlvbihwb3J0KSB7XG4gICAgICAgIHJldHVybiBuZXcgQWx0SGFuZGxlcihmbGFnLCBmdW5jdGlvbihvaykge1xuICAgICAgICAgIGNhbGxiYWNrKG5ldyBBbHRSZXN1bHQob2ssIHBvcnQpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KShwb3J0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBvcnQgPSBvcGVyYXRpb247XG4gICAgICByZXN1bHQgPSBwb3J0Ll90YWtlKChmdW5jdGlvbihwb3J0KSB7XG4gICAgICAgIHJldHVybiBuZXcgQWx0SGFuZGxlcihmbGFnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGNhbGxiYWNrKG5ldyBBbHRSZXN1bHQodmFsdWUsIHBvcnQpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KShwb3J0KSk7XG4gICAgfVxuICAgIC8vIFhYWCBIbW1cbiAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgQm94KSB7XG4gICAgICBjYWxsYmFjayhuZXcgQWx0UmVzdWx0KHJlc3VsdC52YWx1ZSwgcG9ydCkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgaWYgKCEocmVzdWx0IGluc3RhbmNlb2YgQm94KVxuICAgICAgJiYgb3B0aW9uc1xuICAgICAgJiYgaGFzT3duUHJvcGVydHkuY2FsbChvcHRpb25zLCBcImRlZmF1bHRcIikpIHtcbiAgICBpZiAoZmxhZy52YWx1ZSkge1xuICAgICAgZmxhZy52YWx1ZSA9IGZhbHNlO1xuICAgICAgY2FsbGJhY2sobmV3IEFsdFJlc3VsdChvcHRpb25zW1wiZGVmYXVsdFwiXSwgREVGQVVMVCkpO1xuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0cy5ERUZBVUxUID0gREVGQVVMVDtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgZGlzcGF0Y2ggPSByZXF1aXJlKFwiLi9kaXNwYXRjaFwiKTtcbnZhciBjaGFubmVscyA9IHJlcXVpcmUoXCIuL2NoYW5uZWxzXCIpO1xuXG5leHBvcnRzLnRpbWVvdXQgPSBmdW5jdGlvbiB0aW1lb3V0X2NoYW5uZWwobXNlY3MpIHtcbiAgdmFyIGNoYW4gPSBjaGFubmVscy5jaGFuKCk7XG4gIGRpc3BhdGNoLnF1ZXVlX2RlbGF5KGZ1bmN0aW9uKCkge1xuICAgIGNoYW4uY2xvc2UoKTtcbiAgfSwgbXNlY3MpO1xuICByZXR1cm4gY2hhbjtcbn07XG4iLCIvLyAgICAgVW5kZXJzY29yZS5qcyAxLjcuMFxuLy8gICAgIGh0dHA6Ly91bmRlcnNjb3JlanMub3JnXG4vLyAgICAgKGMpIDIwMDktMjAxNCBKZXJlbXkgQXNoa2VuYXMsIERvY3VtZW50Q2xvdWQgYW5kIEludmVzdGlnYXRpdmUgUmVwb3J0ZXJzICYgRWRpdG9yc1xuLy8gICAgIFVuZGVyc2NvcmUgbWF5IGJlIGZyZWVseSBkaXN0cmlidXRlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG5cbihmdW5jdGlvbigpIHtcblxuICAvLyBCYXNlbGluZSBzZXR1cFxuICAvLyAtLS0tLS0tLS0tLS0tLVxuXG4gIC8vIEVzdGFibGlzaCB0aGUgcm9vdCBvYmplY3QsIGB3aW5kb3dgIGluIHRoZSBicm93c2VyLCBvciBgZXhwb3J0c2Agb24gdGhlIHNlcnZlci5cbiAgdmFyIHJvb3QgPSB0aGlzO1xuXG4gIC8vIFNhdmUgdGhlIHByZXZpb3VzIHZhbHVlIG9mIHRoZSBgX2AgdmFyaWFibGUuXG4gIHZhciBwcmV2aW91c1VuZGVyc2NvcmUgPSByb290Ll87XG5cbiAgLy8gU2F2ZSBieXRlcyBpbiB0aGUgbWluaWZpZWQgKGJ1dCBub3QgZ3ppcHBlZCkgdmVyc2lvbjpcbiAgdmFyIEFycmF5UHJvdG8gPSBBcnJheS5wcm90b3R5cGUsIE9ialByb3RvID0gT2JqZWN0LnByb3RvdHlwZSwgRnVuY1Byb3RvID0gRnVuY3Rpb24ucHJvdG90eXBlO1xuXG4gIC8vIENyZWF0ZSBxdWljayByZWZlcmVuY2UgdmFyaWFibGVzIGZvciBzcGVlZCBhY2Nlc3MgdG8gY29yZSBwcm90b3R5cGVzLlxuICB2YXJcbiAgICBwdXNoICAgICAgICAgICAgID0gQXJyYXlQcm90by5wdXNoLFxuICAgIHNsaWNlICAgICAgICAgICAgPSBBcnJheVByb3RvLnNsaWNlLFxuICAgIGNvbmNhdCAgICAgICAgICAgPSBBcnJheVByb3RvLmNvbmNhdCxcbiAgICB0b1N0cmluZyAgICAgICAgID0gT2JqUHJvdG8udG9TdHJpbmcsXG4gICAgaGFzT3duUHJvcGVydHkgICA9IE9ialByb3RvLmhhc093blByb3BlcnR5O1xuXG4gIC8vIEFsbCAqKkVDTUFTY3JpcHQgNSoqIG5hdGl2ZSBmdW5jdGlvbiBpbXBsZW1lbnRhdGlvbnMgdGhhdCB3ZSBob3BlIHRvIHVzZVxuICAvLyBhcmUgZGVjbGFyZWQgaGVyZS5cbiAgdmFyXG4gICAgbmF0aXZlSXNBcnJheSAgICAgID0gQXJyYXkuaXNBcnJheSxcbiAgICBuYXRpdmVLZXlzICAgICAgICAgPSBPYmplY3Qua2V5cyxcbiAgICBuYXRpdmVCaW5kICAgICAgICAgPSBGdW5jUHJvdG8uYmluZDtcblxuICAvLyBDcmVhdGUgYSBzYWZlIHJlZmVyZW5jZSB0byB0aGUgVW5kZXJzY29yZSBvYmplY3QgZm9yIHVzZSBiZWxvdy5cbiAgdmFyIF8gPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAob2JqIGluc3RhbmNlb2YgXykgcmV0dXJuIG9iajtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgXykpIHJldHVybiBuZXcgXyhvYmopO1xuICAgIHRoaXMuX3dyYXBwZWQgPSBvYmo7XG4gIH07XG5cbiAgLy8gRXhwb3J0IHRoZSBVbmRlcnNjb3JlIG9iamVjdCBmb3IgKipOb2RlLmpzKiosIHdpdGhcbiAgLy8gYmFja3dhcmRzLWNvbXBhdGliaWxpdHkgZm9yIHRoZSBvbGQgYHJlcXVpcmUoKWAgQVBJLiBJZiB3ZSdyZSBpblxuICAvLyB0aGUgYnJvd3NlciwgYWRkIGBfYCBhcyBhIGdsb2JhbCBvYmplY3QuXG4gIGlmICh0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgICAgIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IF87XG4gICAgfVxuICAgIGV4cG9ydHMuXyA9IF87XG4gIH0gZWxzZSB7XG4gICAgcm9vdC5fID0gXztcbiAgfVxuXG4gIC8vIEN1cnJlbnQgdmVyc2lvbi5cbiAgXy5WRVJTSU9OID0gJzEuNy4wJztcblxuICAvLyBJbnRlcm5hbCBmdW5jdGlvbiB0aGF0IHJldHVybnMgYW4gZWZmaWNpZW50IChmb3IgY3VycmVudCBlbmdpbmVzKSB2ZXJzaW9uXG4gIC8vIG9mIHRoZSBwYXNzZWQtaW4gY2FsbGJhY2ssIHRvIGJlIHJlcGVhdGVkbHkgYXBwbGllZCBpbiBvdGhlciBVbmRlcnNjb3JlXG4gIC8vIGZ1bmN0aW9ucy5cbiAgdmFyIGNyZWF0ZUNhbGxiYWNrID0gZnVuY3Rpb24oZnVuYywgY29udGV4dCwgYXJnQ291bnQpIHtcbiAgICBpZiAoY29udGV4dCA9PT0gdm9pZCAwKSByZXR1cm4gZnVuYztcbiAgICBzd2l0Y2ggKGFyZ0NvdW50ID09IG51bGwgPyAzIDogYXJnQ291bnQpIHtcbiAgICAgIGNhc2UgMTogcmV0dXJuIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmNhbGwoY29udGV4dCwgdmFsdWUpO1xuICAgICAgfTtcbiAgICAgIGNhc2UgMjogcmV0dXJuIGZ1bmN0aW9uKHZhbHVlLCBvdGhlcikge1xuICAgICAgICByZXR1cm4gZnVuYy5jYWxsKGNvbnRleHQsIHZhbHVlLCBvdGhlcik7XG4gICAgICB9O1xuICAgICAgY2FzZSAzOiByZXR1cm4gZnVuY3Rpb24odmFsdWUsIGluZGV4LCBjb2xsZWN0aW9uKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmNhbGwoY29udGV4dCwgdmFsdWUsIGluZGV4LCBjb2xsZWN0aW9uKTtcbiAgICAgIH07XG4gICAgICBjYXNlIDQ6IHJldHVybiBmdW5jdGlvbihhY2N1bXVsYXRvciwgdmFsdWUsIGluZGV4LCBjb2xsZWN0aW9uKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmNhbGwoY29udGV4dCwgYWNjdW11bGF0b3IsIHZhbHVlLCBpbmRleCwgY29sbGVjdGlvbik7XG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gZnVuYy5hcHBseShjb250ZXh0LCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH07XG5cbiAgLy8gQSBtb3N0bHktaW50ZXJuYWwgZnVuY3Rpb24gdG8gZ2VuZXJhdGUgY2FsbGJhY2tzIHRoYXQgY2FuIGJlIGFwcGxpZWRcbiAgLy8gdG8gZWFjaCBlbGVtZW50IGluIGEgY29sbGVjdGlvbiwgcmV0dXJuaW5nIHRoZSBkZXNpcmVkIHJlc3VsdCDigJQgZWl0aGVyXG4gIC8vIGlkZW50aXR5LCBhbiBhcmJpdHJhcnkgY2FsbGJhY2ssIGEgcHJvcGVydHkgbWF0Y2hlciwgb3IgYSBwcm9wZXJ0eSBhY2Nlc3Nvci5cbiAgXy5pdGVyYXRlZSA9IGZ1bmN0aW9uKHZhbHVlLCBjb250ZXh0LCBhcmdDb3VudCkge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gXy5pZGVudGl0eTtcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHZhbHVlKSkgcmV0dXJuIGNyZWF0ZUNhbGxiYWNrKHZhbHVlLCBjb250ZXh0LCBhcmdDb3VudCk7XG4gICAgaWYgKF8uaXNPYmplY3QodmFsdWUpKSByZXR1cm4gXy5tYXRjaGVzKHZhbHVlKTtcbiAgICByZXR1cm4gXy5wcm9wZXJ0eSh2YWx1ZSk7XG4gIH07XG5cbiAgLy8gQ29sbGVjdGlvbiBGdW5jdGlvbnNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvLyBUaGUgY29ybmVyc3RvbmUsIGFuIGBlYWNoYCBpbXBsZW1lbnRhdGlvbiwgYWthIGBmb3JFYWNoYC5cbiAgLy8gSGFuZGxlcyByYXcgb2JqZWN0cyBpbiBhZGRpdGlvbiB0byBhcnJheS1saWtlcy4gVHJlYXRzIGFsbFxuICAvLyBzcGFyc2UgYXJyYXktbGlrZXMgYXMgaWYgdGhleSB3ZXJlIGRlbnNlLlxuICBfLmVhY2ggPSBfLmZvckVhY2ggPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gb2JqO1xuICAgIGl0ZXJhdGVlID0gY3JlYXRlQ2FsbGJhY2soaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgIHZhciBpLCBsZW5ndGggPSBvYmoubGVuZ3RoO1xuICAgIGlmIChsZW5ndGggPT09ICtsZW5ndGgpIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICBpdGVyYXRlZShvYmpbaV0sIGksIG9iaik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgICBmb3IgKGkgPSAwLCBsZW5ndGggPSBrZXlzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGl0ZXJhdGVlKG9ialtrZXlzW2ldXSwga2V5c1tpXSwgb2JqKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfTtcblxuICAvLyBSZXR1cm4gdGhlIHJlc3VsdHMgb2YgYXBwbHlpbmcgdGhlIGl0ZXJhdGVlIHRvIGVhY2ggZWxlbWVudC5cbiAgXy5tYXAgPSBfLmNvbGxlY3QgPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gW107XG4gICAgaXRlcmF0ZWUgPSBfLml0ZXJhdGVlKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICB2YXIga2V5cyA9IG9iai5sZW5ndGggIT09ICtvYmoubGVuZ3RoICYmIF8ua2V5cyhvYmopLFxuICAgICAgICBsZW5ndGggPSAoa2V5cyB8fCBvYmopLmxlbmd0aCxcbiAgICAgICAgcmVzdWx0cyA9IEFycmF5KGxlbmd0aCksXG4gICAgICAgIGN1cnJlbnRLZXk7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY3VycmVudEtleSA9IGtleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4O1xuICAgICAgcmVzdWx0c1tpbmRleF0gPSBpdGVyYXRlZShvYmpbY3VycmVudEtleV0sIGN1cnJlbnRLZXksIG9iaik7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHRzO1xuICB9O1xuXG4gIHZhciByZWR1Y2VFcnJvciA9ICdSZWR1Y2Ugb2YgZW1wdHkgYXJyYXkgd2l0aCBubyBpbml0aWFsIHZhbHVlJztcblxuICAvLyAqKlJlZHVjZSoqIGJ1aWxkcyB1cCBhIHNpbmdsZSByZXN1bHQgZnJvbSBhIGxpc3Qgb2YgdmFsdWVzLCBha2EgYGluamVjdGAsXG4gIC8vIG9yIGBmb2xkbGAuXG4gIF8ucmVkdWNlID0gXy5mb2xkbCA9IF8uaW5qZWN0ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgbWVtbywgY29udGV4dCkge1xuICAgIGlmIChvYmogPT0gbnVsbCkgb2JqID0gW107XG4gICAgaXRlcmF0ZWUgPSBjcmVhdGVDYWxsYmFjayhpdGVyYXRlZSwgY29udGV4dCwgNCk7XG4gICAgdmFyIGtleXMgPSBvYmoubGVuZ3RoICE9PSArb2JqLmxlbmd0aCAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGgsXG4gICAgICAgIGluZGV4ID0gMCwgY3VycmVudEtleTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDMpIHtcbiAgICAgIGlmICghbGVuZ3RoKSB0aHJvdyBuZXcgVHlwZUVycm9yKHJlZHVjZUVycm9yKTtcbiAgICAgIG1lbW8gPSBvYmpba2V5cyA/IGtleXNbaW5kZXgrK10gOiBpbmRleCsrXTtcbiAgICB9XG4gICAgZm9yICg7IGluZGV4IDwgbGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBjdXJyZW50S2V5ID0ga2V5cyA/IGtleXNbaW5kZXhdIDogaW5kZXg7XG4gICAgICBtZW1vID0gaXRlcmF0ZWUobWVtbywgb2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopO1xuICAgIH1cbiAgICByZXR1cm4gbWVtbztcbiAgfTtcblxuICAvLyBUaGUgcmlnaHQtYXNzb2NpYXRpdmUgdmVyc2lvbiBvZiByZWR1Y2UsIGFsc28ga25vd24gYXMgYGZvbGRyYC5cbiAgXy5yZWR1Y2VSaWdodCA9IF8uZm9sZHIgPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBtZW1vLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSBvYmogPSBbXTtcbiAgICBpdGVyYXRlZSA9IGNyZWF0ZUNhbGxiYWNrKGl0ZXJhdGVlLCBjb250ZXh0LCA0KTtcbiAgICB2YXIga2V5cyA9IG9iai5sZW5ndGggIT09ICsgb2JqLmxlbmd0aCAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgaW5kZXggPSAoa2V5cyB8fCBvYmopLmxlbmd0aCxcbiAgICAgICAgY3VycmVudEtleTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDMpIHtcbiAgICAgIGlmICghaW5kZXgpIHRocm93IG5ldyBUeXBlRXJyb3IocmVkdWNlRXJyb3IpO1xuICAgICAgbWVtbyA9IG9ialtrZXlzID8ga2V5c1stLWluZGV4XSA6IC0taW5kZXhdO1xuICAgIH1cbiAgICB3aGlsZSAoaW5kZXgtLSkge1xuICAgICAgY3VycmVudEtleSA9IGtleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4O1xuICAgICAgbWVtbyA9IGl0ZXJhdGVlKG1lbW8sIG9ialtjdXJyZW50S2V5XSwgY3VycmVudEtleSwgb2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG1lbW87XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBmaXJzdCB2YWx1ZSB3aGljaCBwYXNzZXMgYSB0cnV0aCB0ZXN0LiBBbGlhc2VkIGFzIGBkZXRlY3RgLlxuICBfLmZpbmQgPSBfLmRldGVjdCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgdmFyIHJlc3VsdDtcbiAgICBwcmVkaWNhdGUgPSBfLml0ZXJhdGVlKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgXy5zb21lKG9iaiwgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBsaXN0KSB7XG4gICAgICBpZiAocHJlZGljYXRlKHZhbHVlLCBpbmRleCwgbGlzdCkpIHtcbiAgICAgICAgcmVzdWx0ID0gdmFsdWU7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gUmV0dXJuIGFsbCB0aGUgZWxlbWVudHMgdGhhdCBwYXNzIGEgdHJ1dGggdGVzdC5cbiAgLy8gQWxpYXNlZCBhcyBgc2VsZWN0YC5cbiAgXy5maWx0ZXIgPSBfLnNlbGVjdCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICBpZiAob2JqID09IG51bGwpIHJldHVybiByZXN1bHRzO1xuICAgIHByZWRpY2F0ZSA9IF8uaXRlcmF0ZWUocHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgIGlmIChwcmVkaWNhdGUodmFsdWUsIGluZGV4LCBsaXN0KSkgcmVzdWx0cy5wdXNoKHZhbHVlKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0cztcbiAgfTtcblxuICAvLyBSZXR1cm4gYWxsIHRoZSBlbGVtZW50cyBmb3Igd2hpY2ggYSB0cnV0aCB0ZXN0IGZhaWxzLlxuICBfLnJlamVjdCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgcmV0dXJuIF8uZmlsdGVyKG9iaiwgXy5uZWdhdGUoXy5pdGVyYXRlZShwcmVkaWNhdGUpKSwgY29udGV4dCk7XG4gIH07XG5cbiAgLy8gRGV0ZXJtaW5lIHdoZXRoZXIgYWxsIG9mIHRoZSBlbGVtZW50cyBtYXRjaCBhIHRydXRoIHRlc3QuXG4gIC8vIEFsaWFzZWQgYXMgYGFsbGAuXG4gIF8uZXZlcnkgPSBfLmFsbCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBwcmVkaWNhdGUgPSBfLml0ZXJhdGVlKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgdmFyIGtleXMgPSBvYmoubGVuZ3RoICE9PSArb2JqLmxlbmd0aCAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGgsXG4gICAgICAgIGluZGV4LCBjdXJyZW50S2V5O1xuICAgIGZvciAoaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY3VycmVudEtleSA9IGtleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4O1xuICAgICAgaWYgKCFwcmVkaWNhdGUob2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIC8vIERldGVybWluZSBpZiBhdCBsZWFzdCBvbmUgZWxlbWVudCBpbiB0aGUgb2JqZWN0IG1hdGNoZXMgYSB0cnV0aCB0ZXN0LlxuICAvLyBBbGlhc2VkIGFzIGBhbnlgLlxuICBfLnNvbWUgPSBfLmFueSA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgcHJlZGljYXRlID0gXy5pdGVyYXRlZShwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gb2JqLmxlbmd0aCAhPT0gK29iai5sZW5ndGggJiYgXy5rZXlzKG9iaiksXG4gICAgICAgIGxlbmd0aCA9IChrZXlzIHx8IG9iaikubGVuZ3RoLFxuICAgICAgICBpbmRleCwgY3VycmVudEtleTtcbiAgICBmb3IgKGluZGV4ID0gMDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGN1cnJlbnRLZXkgPSBrZXlzID8ga2V5c1tpbmRleF0gOiBpbmRleDtcbiAgICAgIGlmIChwcmVkaWNhdGUob2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8vIERldGVybWluZSBpZiB0aGUgYXJyYXkgb3Igb2JqZWN0IGNvbnRhaW5zIGEgZ2l2ZW4gdmFsdWUgKHVzaW5nIGA9PT1gKS5cbiAgLy8gQWxpYXNlZCBhcyBgaW5jbHVkZWAuXG4gIF8uY29udGFpbnMgPSBfLmluY2x1ZGUgPSBmdW5jdGlvbihvYmosIHRhcmdldCkge1xuICAgIGlmIChvYmogPT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChvYmoubGVuZ3RoICE9PSArb2JqLmxlbmd0aCkgb2JqID0gXy52YWx1ZXMob2JqKTtcbiAgICByZXR1cm4gXy5pbmRleE9mKG9iaiwgdGFyZ2V0KSA+PSAwO1xuICB9O1xuXG4gIC8vIEludm9rZSBhIG1ldGhvZCAod2l0aCBhcmd1bWVudHMpIG9uIGV2ZXJ5IGl0ZW0gaW4gYSBjb2xsZWN0aW9uLlxuICBfLmludm9rZSA9IGZ1bmN0aW9uKG9iaiwgbWV0aG9kKSB7XG4gICAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gICAgdmFyIGlzRnVuYyA9IF8uaXNGdW5jdGlvbihtZXRob2QpO1xuICAgIHJldHVybiBfLm1hcChvYmosIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICByZXR1cm4gKGlzRnVuYyA/IG1ldGhvZCA6IHZhbHVlW21ldGhvZF0pLmFwcGx5KHZhbHVlLCBhcmdzKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBDb252ZW5pZW5jZSB2ZXJzaW9uIG9mIGEgY29tbW9uIHVzZSBjYXNlIG9mIGBtYXBgOiBmZXRjaGluZyBhIHByb3BlcnR5LlxuICBfLnBsdWNrID0gZnVuY3Rpb24ob2JqLCBrZXkpIHtcbiAgICByZXR1cm4gXy5tYXAob2JqLCBfLnByb3BlcnR5KGtleSkpO1xuICB9O1xuXG4gIC8vIENvbnZlbmllbmNlIHZlcnNpb24gb2YgYSBjb21tb24gdXNlIGNhc2Ugb2YgYGZpbHRlcmA6IHNlbGVjdGluZyBvbmx5IG9iamVjdHNcbiAgLy8gY29udGFpbmluZyBzcGVjaWZpYyBga2V5OnZhbHVlYCBwYWlycy5cbiAgXy53aGVyZSA9IGZ1bmN0aW9uKG9iaiwgYXR0cnMpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIob2JqLCBfLm1hdGNoZXMoYXR0cnMpKTtcbiAgfTtcblxuICAvLyBDb252ZW5pZW5jZSB2ZXJzaW9uIG9mIGEgY29tbW9uIHVzZSBjYXNlIG9mIGBmaW5kYDogZ2V0dGluZyB0aGUgZmlyc3Qgb2JqZWN0XG4gIC8vIGNvbnRhaW5pbmcgc3BlY2lmaWMgYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8uZmluZFdoZXJlID0gZnVuY3Rpb24ob2JqLCBhdHRycykge1xuICAgIHJldHVybiBfLmZpbmQob2JqLCBfLm1hdGNoZXMoYXR0cnMpKTtcbiAgfTtcblxuICAvLyBSZXR1cm4gdGhlIG1heGltdW0gZWxlbWVudCAob3IgZWxlbWVudC1iYXNlZCBjb21wdXRhdGlvbikuXG4gIF8ubWF4ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIHZhciByZXN1bHQgPSAtSW5maW5pdHksIGxhc3RDb21wdXRlZCA9IC1JbmZpbml0eSxcbiAgICAgICAgdmFsdWUsIGNvbXB1dGVkO1xuICAgIGlmIChpdGVyYXRlZSA9PSBudWxsICYmIG9iaiAhPSBudWxsKSB7XG4gICAgICBvYmogPSBvYmoubGVuZ3RoID09PSArb2JqLmxlbmd0aCA/IG9iaiA6IF8udmFsdWVzKG9iaik7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gb2JqLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhbHVlID0gb2JqW2ldO1xuICAgICAgICBpZiAodmFsdWUgPiByZXN1bHQpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpdGVyYXRlZSA9IF8uaXRlcmF0ZWUoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgICAgXy5lYWNoKG9iaiwgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBsaXN0KSB7XG4gICAgICAgIGNvbXB1dGVkID0gaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBsaXN0KTtcbiAgICAgICAgaWYgKGNvbXB1dGVkID4gbGFzdENvbXB1dGVkIHx8IGNvbXB1dGVkID09PSAtSW5maW5pdHkgJiYgcmVzdWx0ID09PSAtSW5maW5pdHkpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgICBsYXN0Q29tcHV0ZWQgPSBjb21wdXRlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBtaW5pbXVtIGVsZW1lbnQgKG9yIGVsZW1lbnQtYmFzZWQgY29tcHV0YXRpb24pLlxuICBfLm1pbiA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICB2YXIgcmVzdWx0ID0gSW5maW5pdHksIGxhc3RDb21wdXRlZCA9IEluZmluaXR5LFxuICAgICAgICB2YWx1ZSwgY29tcHV0ZWQ7XG4gICAgaWYgKGl0ZXJhdGVlID09IG51bGwgJiYgb2JqICE9IG51bGwpIHtcbiAgICAgIG9iaiA9IG9iai5sZW5ndGggPT09ICtvYmoubGVuZ3RoID8gb2JqIDogXy52YWx1ZXMob2JqKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBvYmoubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFsdWUgPSBvYmpbaV07XG4gICAgICAgIGlmICh2YWx1ZSA8IHJlc3VsdCkge1xuICAgICAgICAgIHJlc3VsdCA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGl0ZXJhdGVlID0gXy5pdGVyYXRlZShpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgICAgY29tcHV0ZWQgPSBpdGVyYXRlZSh2YWx1ZSwgaW5kZXgsIGxpc3QpO1xuICAgICAgICBpZiAoY29tcHV0ZWQgPCBsYXN0Q29tcHV0ZWQgfHwgY29tcHV0ZWQgPT09IEluZmluaXR5ICYmIHJlc3VsdCA9PT0gSW5maW5pdHkpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgICBsYXN0Q29tcHV0ZWQgPSBjb21wdXRlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gU2h1ZmZsZSBhIGNvbGxlY3Rpb24sIHVzaW5nIHRoZSBtb2Rlcm4gdmVyc2lvbiBvZiB0aGVcbiAgLy8gW0Zpc2hlci1ZYXRlcyBzaHVmZmxlXShodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Zpc2hlcuKAk1lhdGVzX3NodWZmbGUpLlxuICBfLnNodWZmbGUgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgc2V0ID0gb2JqICYmIG9iai5sZW5ndGggPT09ICtvYmoubGVuZ3RoID8gb2JqIDogXy52YWx1ZXMob2JqKTtcbiAgICB2YXIgbGVuZ3RoID0gc2V0Lmxlbmd0aDtcbiAgICB2YXIgc2h1ZmZsZWQgPSBBcnJheShsZW5ndGgpO1xuICAgIGZvciAodmFyIGluZGV4ID0gMCwgcmFuZDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIHJhbmQgPSBfLnJhbmRvbSgwLCBpbmRleCk7XG4gICAgICBpZiAocmFuZCAhPT0gaW5kZXgpIHNodWZmbGVkW2luZGV4XSA9IHNodWZmbGVkW3JhbmRdO1xuICAgICAgc2h1ZmZsZWRbcmFuZF0gPSBzZXRbaW5kZXhdO1xuICAgIH1cbiAgICByZXR1cm4gc2h1ZmZsZWQ7XG4gIH07XG5cbiAgLy8gU2FtcGxlICoqbioqIHJhbmRvbSB2YWx1ZXMgZnJvbSBhIGNvbGxlY3Rpb24uXG4gIC8vIElmICoqbioqIGlzIG5vdCBzcGVjaWZpZWQsIHJldHVybnMgYSBzaW5nbGUgcmFuZG9tIGVsZW1lbnQuXG4gIC8vIFRoZSBpbnRlcm5hbCBgZ3VhcmRgIGFyZ3VtZW50IGFsbG93cyBpdCB0byB3b3JrIHdpdGggYG1hcGAuXG4gIF8uc2FtcGxlID0gZnVuY3Rpb24ob2JqLCBuLCBndWFyZCkge1xuICAgIGlmIChuID09IG51bGwgfHwgZ3VhcmQpIHtcbiAgICAgIGlmIChvYmoubGVuZ3RoICE9PSArb2JqLmxlbmd0aCkgb2JqID0gXy52YWx1ZXMob2JqKTtcbiAgICAgIHJldHVybiBvYmpbXy5yYW5kb20ob2JqLmxlbmd0aCAtIDEpXTtcbiAgICB9XG4gICAgcmV0dXJuIF8uc2h1ZmZsZShvYmopLnNsaWNlKDAsIE1hdGgubWF4KDAsIG4pKTtcbiAgfTtcblxuICAvLyBTb3J0IHRoZSBvYmplY3QncyB2YWx1ZXMgYnkgYSBjcml0ZXJpb24gcHJvZHVjZWQgYnkgYW4gaXRlcmF0ZWUuXG4gIF8uc29ydEJ5ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIGl0ZXJhdGVlID0gXy5pdGVyYXRlZShpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgcmV0dXJuIF8ucGx1Y2soXy5tYXAob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAgaW5kZXg6IGluZGV4LFxuICAgICAgICBjcml0ZXJpYTogaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBsaXN0KVxuICAgICAgfTtcbiAgICB9KS5zb3J0KGZ1bmN0aW9uKGxlZnQsIHJpZ2h0KSB7XG4gICAgICB2YXIgYSA9IGxlZnQuY3JpdGVyaWE7XG4gICAgICB2YXIgYiA9IHJpZ2h0LmNyaXRlcmlhO1xuICAgICAgaWYgKGEgIT09IGIpIHtcbiAgICAgICAgaWYgKGEgPiBiIHx8IGEgPT09IHZvaWQgMCkgcmV0dXJuIDE7XG4gICAgICAgIGlmIChhIDwgYiB8fCBiID09PSB2b2lkIDApIHJldHVybiAtMTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBsZWZ0LmluZGV4IC0gcmlnaHQuaW5kZXg7XG4gICAgfSksICd2YWx1ZScpO1xuICB9O1xuXG4gIC8vIEFuIGludGVybmFsIGZ1bmN0aW9uIHVzZWQgZm9yIGFnZ3JlZ2F0ZSBcImdyb3VwIGJ5XCIgb3BlcmF0aW9ucy5cbiAgdmFyIGdyb3VwID0gZnVuY3Rpb24oYmVoYXZpb3IpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgICAgaXRlcmF0ZWUgPSBfLml0ZXJhdGVlKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICAgIF8uZWFjaChvYmosIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCkge1xuICAgICAgICB2YXIga2V5ID0gaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBvYmopO1xuICAgICAgICBiZWhhdmlvcihyZXN1bHQsIHZhbHVlLCBrZXkpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gIH07XG5cbiAgLy8gR3JvdXBzIHRoZSBvYmplY3QncyB2YWx1ZXMgYnkgYSBjcml0ZXJpb24uIFBhc3MgZWl0aGVyIGEgc3RyaW5nIGF0dHJpYnV0ZVxuICAvLyB0byBncm91cCBieSwgb3IgYSBmdW5jdGlvbiB0aGF0IHJldHVybnMgdGhlIGNyaXRlcmlvbi5cbiAgXy5ncm91cEJ5ID0gZ3JvdXAoZnVuY3Rpb24ocmVzdWx0LCB2YWx1ZSwga2V5KSB7XG4gICAgaWYgKF8uaGFzKHJlc3VsdCwga2V5KSkgcmVzdWx0W2tleV0ucHVzaCh2YWx1ZSk7IGVsc2UgcmVzdWx0W2tleV0gPSBbdmFsdWVdO1xuICB9KTtcblxuICAvLyBJbmRleGVzIHRoZSBvYmplY3QncyB2YWx1ZXMgYnkgYSBjcml0ZXJpb24sIHNpbWlsYXIgdG8gYGdyb3VwQnlgLCBidXQgZm9yXG4gIC8vIHdoZW4geW91IGtub3cgdGhhdCB5b3VyIGluZGV4IHZhbHVlcyB3aWxsIGJlIHVuaXF1ZS5cbiAgXy5pbmRleEJ5ID0gZ3JvdXAoZnVuY3Rpb24ocmVzdWx0LCB2YWx1ZSwga2V5KSB7XG4gICAgcmVzdWx0W2tleV0gPSB2YWx1ZTtcbiAgfSk7XG5cbiAgLy8gQ291bnRzIGluc3RhbmNlcyBvZiBhbiBvYmplY3QgdGhhdCBncm91cCBieSBhIGNlcnRhaW4gY3JpdGVyaW9uLiBQYXNzXG4gIC8vIGVpdGhlciBhIHN0cmluZyBhdHRyaWJ1dGUgdG8gY291bnQgYnksIG9yIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIHRoZVxuICAvLyBjcml0ZXJpb24uXG4gIF8uY291bnRCeSA9IGdyb3VwKGZ1bmN0aW9uKHJlc3VsdCwgdmFsdWUsIGtleSkge1xuICAgIGlmIChfLmhhcyhyZXN1bHQsIGtleSkpIHJlc3VsdFtrZXldKys7IGVsc2UgcmVzdWx0W2tleV0gPSAxO1xuICB9KTtcblxuICAvLyBVc2UgYSBjb21wYXJhdG9yIGZ1bmN0aW9uIHRvIGZpZ3VyZSBvdXQgdGhlIHNtYWxsZXN0IGluZGV4IGF0IHdoaWNoXG4gIC8vIGFuIG9iamVjdCBzaG91bGQgYmUgaW5zZXJ0ZWQgc28gYXMgdG8gbWFpbnRhaW4gb3JkZXIuIFVzZXMgYmluYXJ5IHNlYXJjaC5cbiAgXy5zb3J0ZWRJbmRleCA9IGZ1bmN0aW9uKGFycmF5LCBvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaXRlcmF0ZWUgPSBfLml0ZXJhdGVlKGl0ZXJhdGVlLCBjb250ZXh0LCAxKTtcbiAgICB2YXIgdmFsdWUgPSBpdGVyYXRlZShvYmopO1xuICAgIHZhciBsb3cgPSAwLCBoaWdoID0gYXJyYXkubGVuZ3RoO1xuICAgIHdoaWxlIChsb3cgPCBoaWdoKSB7XG4gICAgICB2YXIgbWlkID0gbG93ICsgaGlnaCA+Pj4gMTtcbiAgICAgIGlmIChpdGVyYXRlZShhcnJheVttaWRdKSA8IHZhbHVlKSBsb3cgPSBtaWQgKyAxOyBlbHNlIGhpZ2ggPSBtaWQ7XG4gICAgfVxuICAgIHJldHVybiBsb3c7XG4gIH07XG5cbiAgLy8gU2FmZWx5IGNyZWF0ZSBhIHJlYWwsIGxpdmUgYXJyYXkgZnJvbSBhbnl0aGluZyBpdGVyYWJsZS5cbiAgXy50b0FycmF5ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKCFvYmopIHJldHVybiBbXTtcbiAgICBpZiAoXy5pc0FycmF5KG9iaikpIHJldHVybiBzbGljZS5jYWxsKG9iaik7XG4gICAgaWYgKG9iai5sZW5ndGggPT09ICtvYmoubGVuZ3RoKSByZXR1cm4gXy5tYXAob2JqLCBfLmlkZW50aXR5KTtcbiAgICByZXR1cm4gXy52YWx1ZXMob2JqKTtcbiAgfTtcblxuICAvLyBSZXR1cm4gdGhlIG51bWJlciBvZiBlbGVtZW50cyBpbiBhbiBvYmplY3QuXG4gIF8uc2l6ZSA9IGZ1bmN0aW9uKG9iaikge1xuICAgIGlmIChvYmogPT0gbnVsbCkgcmV0dXJuIDA7XG4gICAgcmV0dXJuIG9iai5sZW5ndGggPT09ICtvYmoubGVuZ3RoID8gb2JqLmxlbmd0aCA6IF8ua2V5cyhvYmopLmxlbmd0aDtcbiAgfTtcblxuICAvLyBTcGxpdCBhIGNvbGxlY3Rpb24gaW50byB0d28gYXJyYXlzOiBvbmUgd2hvc2UgZWxlbWVudHMgYWxsIHNhdGlzZnkgdGhlIGdpdmVuXG4gIC8vIHByZWRpY2F0ZSwgYW5kIG9uZSB3aG9zZSBlbGVtZW50cyBhbGwgZG8gbm90IHNhdGlzZnkgdGhlIHByZWRpY2F0ZS5cbiAgXy5wYXJ0aXRpb24gPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHByZWRpY2F0ZSA9IF8uaXRlcmF0ZWUocHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICB2YXIgcGFzcyA9IFtdLCBmYWlsID0gW107XG4gICAgXy5lYWNoKG9iaiwgZnVuY3Rpb24odmFsdWUsIGtleSwgb2JqKSB7XG4gICAgICAocHJlZGljYXRlKHZhbHVlLCBrZXksIG9iaikgPyBwYXNzIDogZmFpbCkucHVzaCh2YWx1ZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwYXNzLCBmYWlsXTtcbiAgfTtcblxuICAvLyBBcnJheSBGdW5jdGlvbnNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gR2V0IHRoZSBmaXJzdCBlbGVtZW50IG9mIGFuIGFycmF5LiBQYXNzaW5nICoqbioqIHdpbGwgcmV0dXJuIHRoZSBmaXJzdCBOXG4gIC8vIHZhbHVlcyBpbiB0aGUgYXJyYXkuIEFsaWFzZWQgYXMgYGhlYWRgIGFuZCBgdGFrZWAuIFRoZSAqKmd1YXJkKiogY2hlY2tcbiAgLy8gYWxsb3dzIGl0IHRvIHdvcmsgd2l0aCBgXy5tYXBgLlxuICBfLmZpcnN0ID0gXy5oZWFkID0gXy50YWtlID0gZnVuY3Rpb24oYXJyYXksIG4sIGd1YXJkKSB7XG4gICAgaWYgKGFycmF5ID09IG51bGwpIHJldHVybiB2b2lkIDA7XG4gICAgaWYgKG4gPT0gbnVsbCB8fCBndWFyZCkgcmV0dXJuIGFycmF5WzBdO1xuICAgIGlmIChuIDwgMCkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBzbGljZS5jYWxsKGFycmF5LCAwLCBuKTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGV2ZXJ5dGhpbmcgYnV0IHRoZSBsYXN0IGVudHJ5IG9mIHRoZSBhcnJheS4gRXNwZWNpYWxseSB1c2VmdWwgb25cbiAgLy8gdGhlIGFyZ3VtZW50cyBvYmplY3QuIFBhc3NpbmcgKipuKiogd2lsbCByZXR1cm4gYWxsIHRoZSB2YWx1ZXMgaW5cbiAgLy8gdGhlIGFycmF5LCBleGNsdWRpbmcgdGhlIGxhc3QgTi4gVGhlICoqZ3VhcmQqKiBjaGVjayBhbGxvd3MgaXQgdG8gd29yayB3aXRoXG4gIC8vIGBfLm1hcGAuXG4gIF8uaW5pdGlhbCA9IGZ1bmN0aW9uKGFycmF5LCBuLCBndWFyZCkge1xuICAgIHJldHVybiBzbGljZS5jYWxsKGFycmF5LCAwLCBNYXRoLm1heCgwLCBhcnJheS5sZW5ndGggLSAobiA9PSBudWxsIHx8IGd1YXJkID8gMSA6IG4pKSk7XG4gIH07XG5cbiAgLy8gR2V0IHRoZSBsYXN0IGVsZW1lbnQgb2YgYW4gYXJyYXkuIFBhc3NpbmcgKipuKiogd2lsbCByZXR1cm4gdGhlIGxhc3QgTlxuICAvLyB2YWx1ZXMgaW4gdGhlIGFycmF5LiBUaGUgKipndWFyZCoqIGNoZWNrIGFsbG93cyBpdCB0byB3b3JrIHdpdGggYF8ubWFwYC5cbiAgXy5sYXN0ID0gZnVuY3Rpb24oYXJyYXksIG4sIGd1YXJkKSB7XG4gICAgaWYgKGFycmF5ID09IG51bGwpIHJldHVybiB2b2lkIDA7XG4gICAgaWYgKG4gPT0gbnVsbCB8fCBndWFyZCkgcmV0dXJuIGFycmF5W2FycmF5Lmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiBzbGljZS5jYWxsKGFycmF5LCBNYXRoLm1heChhcnJheS5sZW5ndGggLSBuLCAwKSk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBldmVyeXRoaW5nIGJ1dCB0aGUgZmlyc3QgZW50cnkgb2YgdGhlIGFycmF5LiBBbGlhc2VkIGFzIGB0YWlsYCBhbmQgYGRyb3BgLlxuICAvLyBFc3BlY2lhbGx5IHVzZWZ1bCBvbiB0aGUgYXJndW1lbnRzIG9iamVjdC4gUGFzc2luZyBhbiAqKm4qKiB3aWxsIHJldHVyblxuICAvLyB0aGUgcmVzdCBOIHZhbHVlcyBpbiB0aGUgYXJyYXkuIFRoZSAqKmd1YXJkKipcbiAgLy8gY2hlY2sgYWxsb3dzIGl0IHRvIHdvcmsgd2l0aCBgXy5tYXBgLlxuICBfLnJlc3QgPSBfLnRhaWwgPSBfLmRyb3AgPSBmdW5jdGlvbihhcnJheSwgbiwgZ3VhcmQpIHtcbiAgICByZXR1cm4gc2xpY2UuY2FsbChhcnJheSwgbiA9PSBudWxsIHx8IGd1YXJkID8gMSA6IG4pO1xuICB9O1xuXG4gIC8vIFRyaW0gb3V0IGFsbCBmYWxzeSB2YWx1ZXMgZnJvbSBhbiBhcnJheS5cbiAgXy5jb21wYWN0ID0gZnVuY3Rpb24oYXJyYXkpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIoYXJyYXksIF8uaWRlbnRpdHkpO1xuICB9O1xuXG4gIC8vIEludGVybmFsIGltcGxlbWVudGF0aW9uIG9mIGEgcmVjdXJzaXZlIGBmbGF0dGVuYCBmdW5jdGlvbi5cbiAgdmFyIGZsYXR0ZW4gPSBmdW5jdGlvbihpbnB1dCwgc2hhbGxvdywgc3RyaWN0LCBvdXRwdXQpIHtcbiAgICBpZiAoc2hhbGxvdyAmJiBfLmV2ZXJ5KGlucHV0LCBfLmlzQXJyYXkpKSB7XG4gICAgICByZXR1cm4gY29uY2F0LmFwcGx5KG91dHB1dCwgaW5wdXQpO1xuICAgIH1cbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gaW5wdXQubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciB2YWx1ZSA9IGlucHV0W2ldO1xuICAgICAgaWYgKCFfLmlzQXJyYXkodmFsdWUpICYmICFfLmlzQXJndW1lbnRzKHZhbHVlKSkge1xuICAgICAgICBpZiAoIXN0cmljdCkgb3V0cHV0LnB1c2godmFsdWUpO1xuICAgICAgfSBlbHNlIGlmIChzaGFsbG93KSB7XG4gICAgICAgIHB1c2guYXBwbHkob3V0cHV0LCB2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmbGF0dGVuKHZhbHVlLCBzaGFsbG93LCBzdHJpY3QsIG91dHB1dCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH07XG5cbiAgLy8gRmxhdHRlbiBvdXQgYW4gYXJyYXksIGVpdGhlciByZWN1cnNpdmVseSAoYnkgZGVmYXVsdCksIG9yIGp1c3Qgb25lIGxldmVsLlxuICBfLmZsYXR0ZW4gPSBmdW5jdGlvbihhcnJheSwgc2hhbGxvdykge1xuICAgIHJldHVybiBmbGF0dGVuKGFycmF5LCBzaGFsbG93LCBmYWxzZSwgW10pO1xuICB9O1xuXG4gIC8vIFJldHVybiBhIHZlcnNpb24gb2YgdGhlIGFycmF5IHRoYXQgZG9lcyBub3QgY29udGFpbiB0aGUgc3BlY2lmaWVkIHZhbHVlKHMpLlxuICBfLndpdGhvdXQgPSBmdW5jdGlvbihhcnJheSkge1xuICAgIHJldHVybiBfLmRpZmZlcmVuY2UoYXJyYXksIHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSk7XG4gIH07XG5cbiAgLy8gUHJvZHVjZSBhIGR1cGxpY2F0ZS1mcmVlIHZlcnNpb24gb2YgdGhlIGFycmF5LiBJZiB0aGUgYXJyYXkgaGFzIGFscmVhZHlcbiAgLy8gYmVlbiBzb3J0ZWQsIHlvdSBoYXZlIHRoZSBvcHRpb24gb2YgdXNpbmcgYSBmYXN0ZXIgYWxnb3JpdGhtLlxuICAvLyBBbGlhc2VkIGFzIGB1bmlxdWVgLlxuICBfLnVuaXEgPSBfLnVuaXF1ZSA9IGZ1bmN0aW9uKGFycmF5LCBpc1NvcnRlZCwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpZiAoYXJyYXkgPT0gbnVsbCkgcmV0dXJuIFtdO1xuICAgIGlmICghXy5pc0Jvb2xlYW4oaXNTb3J0ZWQpKSB7XG4gICAgICBjb250ZXh0ID0gaXRlcmF0ZWU7XG4gICAgICBpdGVyYXRlZSA9IGlzU29ydGVkO1xuICAgICAgaXNTb3J0ZWQgPSBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGl0ZXJhdGVlICE9IG51bGwpIGl0ZXJhdGVlID0gXy5pdGVyYXRlZShpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgIHZhciBzZWVuID0gW107XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmFsdWUgPSBhcnJheVtpXTtcbiAgICAgIGlmIChpc1NvcnRlZCkge1xuICAgICAgICBpZiAoIWkgfHwgc2VlbiAhPT0gdmFsdWUpIHJlc3VsdC5wdXNoKHZhbHVlKTtcbiAgICAgICAgc2VlbiA9IHZhbHVlO1xuICAgICAgfSBlbHNlIGlmIChpdGVyYXRlZSkge1xuICAgICAgICB2YXIgY29tcHV0ZWQgPSBpdGVyYXRlZSh2YWx1ZSwgaSwgYXJyYXkpO1xuICAgICAgICBpZiAoXy5pbmRleE9mKHNlZW4sIGNvbXB1dGVkKSA8IDApIHtcbiAgICAgICAgICBzZWVuLnB1c2goY29tcHV0ZWQpO1xuICAgICAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChfLmluZGV4T2YocmVzdWx0LCB2YWx1ZSkgPCAwKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBQcm9kdWNlIGFuIGFycmF5IHRoYXQgY29udGFpbnMgdGhlIHVuaW9uOiBlYWNoIGRpc3RpbmN0IGVsZW1lbnQgZnJvbSBhbGwgb2ZcbiAgLy8gdGhlIHBhc3NlZC1pbiBhcnJheXMuXG4gIF8udW5pb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXy51bmlxKGZsYXR0ZW4oYXJndW1lbnRzLCB0cnVlLCB0cnVlLCBbXSkpO1xuICB9O1xuXG4gIC8vIFByb2R1Y2UgYW4gYXJyYXkgdGhhdCBjb250YWlucyBldmVyeSBpdGVtIHNoYXJlZCBiZXR3ZWVuIGFsbCB0aGVcbiAgLy8gcGFzc2VkLWluIGFycmF5cy5cbiAgXy5pbnRlcnNlY3Rpb24gPSBmdW5jdGlvbihhcnJheSkge1xuICAgIGlmIChhcnJheSA9PSBudWxsKSByZXR1cm4gW107XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgIHZhciBhcmdzTGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gYXJyYXkubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBpdGVtID0gYXJyYXlbaV07XG4gICAgICBpZiAoXy5jb250YWlucyhyZXN1bHQsIGl0ZW0pKSBjb250aW51ZTtcbiAgICAgIGZvciAodmFyIGogPSAxOyBqIDwgYXJnc0xlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICghXy5jb250YWlucyhhcmd1bWVudHNbal0sIGl0ZW0pKSBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmIChqID09PSBhcmdzTGVuZ3RoKSByZXN1bHQucHVzaChpdGVtKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBUYWtlIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gb25lIGFycmF5IGFuZCBhIG51bWJlciBvZiBvdGhlciBhcnJheXMuXG4gIC8vIE9ubHkgdGhlIGVsZW1lbnRzIHByZXNlbnQgaW4ganVzdCB0aGUgZmlyc3QgYXJyYXkgd2lsbCByZW1haW4uXG4gIF8uZGlmZmVyZW5jZSA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgdmFyIHJlc3QgPSBmbGF0dGVuKHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSwgdHJ1ZSwgdHJ1ZSwgW10pO1xuICAgIHJldHVybiBfLmZpbHRlcihhcnJheSwgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgcmV0dXJuICFfLmNvbnRhaW5zKHJlc3QsIHZhbHVlKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBaaXAgdG9nZXRoZXIgbXVsdGlwbGUgbGlzdHMgaW50byBhIHNpbmdsZSBhcnJheSAtLSBlbGVtZW50cyB0aGF0IHNoYXJlXG4gIC8vIGFuIGluZGV4IGdvIHRvZ2V0aGVyLlxuICBfLnppcCA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgaWYgKGFycmF5ID09IG51bGwpIHJldHVybiBbXTtcbiAgICB2YXIgbGVuZ3RoID0gXy5tYXgoYXJndW1lbnRzLCAnbGVuZ3RoJykubGVuZ3RoO1xuICAgIHZhciByZXN1bHRzID0gQXJyYXkobGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICByZXN1bHRzW2ldID0gXy5wbHVjayhhcmd1bWVudHMsIGkpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0cztcbiAgfTtcblxuICAvLyBDb252ZXJ0cyBsaXN0cyBpbnRvIG9iamVjdHMuIFBhc3MgZWl0aGVyIGEgc2luZ2xlIGFycmF5IG9mIGBba2V5LCB2YWx1ZV1gXG4gIC8vIHBhaXJzLCBvciB0d28gcGFyYWxsZWwgYXJyYXlzIG9mIHRoZSBzYW1lIGxlbmd0aCAtLSBvbmUgb2Yga2V5cywgYW5kIG9uZSBvZlxuICAvLyB0aGUgY29ycmVzcG9uZGluZyB2YWx1ZXMuXG4gIF8ub2JqZWN0ID0gZnVuY3Rpb24obGlzdCwgdmFsdWVzKSB7XG4gICAgaWYgKGxpc3QgPT0gbnVsbCkgcmV0dXJuIHt9O1xuICAgIHZhciByZXN1bHQgPSB7fTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gbGlzdC5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICByZXN1bHRbbGlzdFtpXV0gPSB2YWx1ZXNbaV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRbbGlzdFtpXVswXV0gPSBsaXN0W2ldWzFdO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIFJldHVybiB0aGUgcG9zaXRpb24gb2YgdGhlIGZpcnN0IG9jY3VycmVuY2Ugb2YgYW4gaXRlbSBpbiBhbiBhcnJheSxcbiAgLy8gb3IgLTEgaWYgdGhlIGl0ZW0gaXMgbm90IGluY2x1ZGVkIGluIHRoZSBhcnJheS5cbiAgLy8gSWYgdGhlIGFycmF5IGlzIGxhcmdlIGFuZCBhbHJlYWR5IGluIHNvcnQgb3JkZXIsIHBhc3MgYHRydWVgXG4gIC8vIGZvciAqKmlzU29ydGVkKiogdG8gdXNlIGJpbmFyeSBzZWFyY2guXG4gIF8uaW5kZXhPZiA9IGZ1bmN0aW9uKGFycmF5LCBpdGVtLCBpc1NvcnRlZCkge1xuICAgIGlmIChhcnJheSA9PSBudWxsKSByZXR1cm4gLTE7XG4gICAgdmFyIGkgPSAwLCBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gICAgaWYgKGlzU29ydGVkKSB7XG4gICAgICBpZiAodHlwZW9mIGlzU29ydGVkID09ICdudW1iZXInKSB7XG4gICAgICAgIGkgPSBpc1NvcnRlZCA8IDAgPyBNYXRoLm1heCgwLCBsZW5ndGggKyBpc1NvcnRlZCkgOiBpc1NvcnRlZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGkgPSBfLnNvcnRlZEluZGV4KGFycmF5LCBpdGVtKTtcbiAgICAgICAgcmV0dXJuIGFycmF5W2ldID09PSBpdGVtID8gaSA6IC0xO1xuICAgICAgfVxuICAgIH1cbiAgICBmb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSBpZiAoYXJyYXlbaV0gPT09IGl0ZW0pIHJldHVybiBpO1xuICAgIHJldHVybiAtMTtcbiAgfTtcblxuICBfLmxhc3RJbmRleE9mID0gZnVuY3Rpb24oYXJyYXksIGl0ZW0sIGZyb20pIHtcbiAgICBpZiAoYXJyYXkgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgIHZhciBpZHggPSBhcnJheS5sZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBmcm9tID09ICdudW1iZXInKSB7XG4gICAgICBpZHggPSBmcm9tIDwgMCA/IGlkeCArIGZyb20gKyAxIDogTWF0aC5taW4oaWR4LCBmcm9tICsgMSk7XG4gICAgfVxuICAgIHdoaWxlICgtLWlkeCA+PSAwKSBpZiAoYXJyYXlbaWR4XSA9PT0gaXRlbSkgcmV0dXJuIGlkeDtcbiAgICByZXR1cm4gLTE7XG4gIH07XG5cbiAgLy8gR2VuZXJhdGUgYW4gaW50ZWdlciBBcnJheSBjb250YWluaW5nIGFuIGFyaXRobWV0aWMgcHJvZ3Jlc3Npb24uIEEgcG9ydCBvZlxuICAvLyB0aGUgbmF0aXZlIFB5dGhvbiBgcmFuZ2UoKWAgZnVuY3Rpb24uIFNlZVxuICAvLyBbdGhlIFB5dGhvbiBkb2N1bWVudGF0aW9uXShodHRwOi8vZG9jcy5weXRob24ub3JnL2xpYnJhcnkvZnVuY3Rpb25zLmh0bWwjcmFuZ2UpLlxuICBfLnJhbmdlID0gZnVuY3Rpb24oc3RhcnQsIHN0b3AsIHN0ZXApIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8PSAxKSB7XG4gICAgICBzdG9wID0gc3RhcnQgfHwgMDtcbiAgICAgIHN0YXJ0ID0gMDtcbiAgICB9XG4gICAgc3RlcCA9IHN0ZXAgfHwgMTtcblxuICAgIHZhciBsZW5ndGggPSBNYXRoLm1heChNYXRoLmNlaWwoKHN0b3AgLSBzdGFydCkgLyBzdGVwKSwgMCk7XG4gICAgdmFyIHJhbmdlID0gQXJyYXkobGVuZ3RoKTtcblxuICAgIGZvciAodmFyIGlkeCA9IDA7IGlkeCA8IGxlbmd0aDsgaWR4KyssIHN0YXJ0ICs9IHN0ZXApIHtcbiAgICAgIHJhbmdlW2lkeF0gPSBzdGFydDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmFuZ2U7XG4gIH07XG5cbiAgLy8gRnVuY3Rpb24gKGFoZW0pIEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvLyBSZXVzYWJsZSBjb25zdHJ1Y3RvciBmdW5jdGlvbiBmb3IgcHJvdG90eXBlIHNldHRpbmcuXG4gIHZhciBDdG9yID0gZnVuY3Rpb24oKXt9O1xuXG4gIC8vIENyZWF0ZSBhIGZ1bmN0aW9uIGJvdW5kIHRvIGEgZ2l2ZW4gb2JqZWN0IChhc3NpZ25pbmcgYHRoaXNgLCBhbmQgYXJndW1lbnRzLFxuICAvLyBvcHRpb25hbGx5KS4gRGVsZWdhdGVzIHRvICoqRUNNQVNjcmlwdCA1KioncyBuYXRpdmUgYEZ1bmN0aW9uLmJpbmRgIGlmXG4gIC8vIGF2YWlsYWJsZS5cbiAgXy5iaW5kID0gZnVuY3Rpb24oZnVuYywgY29udGV4dCkge1xuICAgIHZhciBhcmdzLCBib3VuZDtcbiAgICBpZiAobmF0aXZlQmluZCAmJiBmdW5jLmJpbmQgPT09IG5hdGl2ZUJpbmQpIHJldHVybiBuYXRpdmVCaW5kLmFwcGx5KGZ1bmMsIHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSk7XG4gICAgaWYgKCFfLmlzRnVuY3Rpb24oZnVuYykpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0JpbmQgbXVzdCBiZSBjYWxsZWQgb24gYSBmdW5jdGlvbicpO1xuICAgIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gICAgYm91bmQgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBib3VuZCkpIHJldHVybiBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MuY29uY2F0KHNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgQ3Rvci5wcm90b3R5cGUgPSBmdW5jLnByb3RvdHlwZTtcbiAgICAgIHZhciBzZWxmID0gbmV3IEN0b3I7XG4gICAgICBDdG9yLnByb3RvdHlwZSA9IG51bGw7XG4gICAgICB2YXIgcmVzdWx0ID0gZnVuYy5hcHBseShzZWxmLCBhcmdzLmNvbmNhdChzbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgIGlmIChfLmlzT2JqZWN0KHJlc3VsdCkpIHJldHVybiByZXN1bHQ7XG4gICAgICByZXR1cm4gc2VsZjtcbiAgICB9O1xuICAgIHJldHVybiBib3VuZDtcbiAgfTtcblxuICAvLyBQYXJ0aWFsbHkgYXBwbHkgYSBmdW5jdGlvbiBieSBjcmVhdGluZyBhIHZlcnNpb24gdGhhdCBoYXMgaGFkIHNvbWUgb2YgaXRzXG4gIC8vIGFyZ3VtZW50cyBwcmUtZmlsbGVkLCB3aXRob3V0IGNoYW5naW5nIGl0cyBkeW5hbWljIGB0aGlzYCBjb250ZXh0LiBfIGFjdHNcbiAgLy8gYXMgYSBwbGFjZWhvbGRlciwgYWxsb3dpbmcgYW55IGNvbWJpbmF0aW9uIG9mIGFyZ3VtZW50cyB0byBiZSBwcmUtZmlsbGVkLlxuICBfLnBhcnRpYWwgPSBmdW5jdGlvbihmdW5jKSB7XG4gICAgdmFyIGJvdW5kQXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcG9zaXRpb24gPSAwO1xuICAgICAgdmFyIGFyZ3MgPSBib3VuZEFyZ3Muc2xpY2UoKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBhcmdzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChhcmdzW2ldID09PSBfKSBhcmdzW2ldID0gYXJndW1lbnRzW3Bvc2l0aW9uKytdO1xuICAgICAgfVxuICAgICAgd2hpbGUgKHBvc2l0aW9uIDwgYXJndW1lbnRzLmxlbmd0aCkgYXJncy5wdXNoKGFyZ3VtZW50c1twb3NpdGlvbisrXSk7XG4gICAgICByZXR1cm4gZnVuYy5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9O1xuICB9O1xuXG4gIC8vIEJpbmQgYSBudW1iZXIgb2YgYW4gb2JqZWN0J3MgbWV0aG9kcyB0byB0aGF0IG9iamVjdC4gUmVtYWluaW5nIGFyZ3VtZW50c1xuICAvLyBhcmUgdGhlIG1ldGhvZCBuYW1lcyB0byBiZSBib3VuZC4gVXNlZnVsIGZvciBlbnN1cmluZyB0aGF0IGFsbCBjYWxsYmFja3NcbiAgLy8gZGVmaW5lZCBvbiBhbiBvYmplY3QgYmVsb25nIHRvIGl0LlxuICBfLmJpbmRBbGwgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgaSwgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aCwga2V5O1xuICAgIGlmIChsZW5ndGggPD0gMSkgdGhyb3cgbmV3IEVycm9yKCdiaW5kQWxsIG11c3QgYmUgcGFzc2VkIGZ1bmN0aW9uIG5hbWVzJyk7XG4gICAgZm9yIChpID0gMTsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBhcmd1bWVudHNbaV07XG4gICAgICBvYmpba2V5XSA9IF8uYmluZChvYmpba2V5XSwgb2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfTtcblxuICAvLyBNZW1vaXplIGFuIGV4cGVuc2l2ZSBmdW5jdGlvbiBieSBzdG9yaW5nIGl0cyByZXN1bHRzLlxuICBfLm1lbW9pemUgPSBmdW5jdGlvbihmdW5jLCBoYXNoZXIpIHtcbiAgICB2YXIgbWVtb2l6ZSA9IGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyIGNhY2hlID0gbWVtb2l6ZS5jYWNoZTtcbiAgICAgIHZhciBhZGRyZXNzID0gaGFzaGVyID8gaGFzaGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBrZXk7XG4gICAgICBpZiAoIV8uaGFzKGNhY2hlLCBhZGRyZXNzKSkgY2FjaGVbYWRkcmVzc10gPSBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICByZXR1cm4gY2FjaGVbYWRkcmVzc107XG4gICAgfTtcbiAgICBtZW1vaXplLmNhY2hlID0ge307XG4gICAgcmV0dXJuIG1lbW9pemU7XG4gIH07XG5cbiAgLy8gRGVsYXlzIGEgZnVuY3Rpb24gZm9yIHRoZSBnaXZlbiBudW1iZXIgb2YgbWlsbGlzZWNvbmRzLCBhbmQgdGhlbiBjYWxsc1xuICAvLyBpdCB3aXRoIHRoZSBhcmd1bWVudHMgc3VwcGxpZWQuXG4gIF8uZGVsYXkgPSBmdW5jdGlvbihmdW5jLCB3YWl0KSB7XG4gICAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcbiAgICAgIHJldHVybiBmdW5jLmFwcGx5KG51bGwsIGFyZ3MpO1xuICAgIH0sIHdhaXQpO1xuICB9O1xuXG4gIC8vIERlZmVycyBhIGZ1bmN0aW9uLCBzY2hlZHVsaW5nIGl0IHRvIHJ1biBhZnRlciB0aGUgY3VycmVudCBjYWxsIHN0YWNrIGhhc1xuICAvLyBjbGVhcmVkLlxuICBfLmRlZmVyID0gZnVuY3Rpb24oZnVuYykge1xuICAgIHJldHVybiBfLmRlbGF5LmFwcGx5KF8sIFtmdW5jLCAxXS5jb25jYXQoc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKSk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uLCB0aGF0LCB3aGVuIGludm9rZWQsIHdpbGwgb25seSBiZSB0cmlnZ2VyZWQgYXQgbW9zdCBvbmNlXG4gIC8vIGR1cmluZyBhIGdpdmVuIHdpbmRvdyBvZiB0aW1lLiBOb3JtYWxseSwgdGhlIHRocm90dGxlZCBmdW5jdGlvbiB3aWxsIHJ1blxuICAvLyBhcyBtdWNoIGFzIGl0IGNhbiwgd2l0aG91dCBldmVyIGdvaW5nIG1vcmUgdGhhbiBvbmNlIHBlciBgd2FpdGAgZHVyYXRpb247XG4gIC8vIGJ1dCBpZiB5b3UnZCBsaWtlIHRvIGRpc2FibGUgdGhlIGV4ZWN1dGlvbiBvbiB0aGUgbGVhZGluZyBlZGdlLCBwYXNzXG4gIC8vIGB7bGVhZGluZzogZmFsc2V9YC4gVG8gZGlzYWJsZSBleGVjdXRpb24gb24gdGhlIHRyYWlsaW5nIGVkZ2UsIGRpdHRvLlxuICBfLnRocm90dGxlID0gZnVuY3Rpb24oZnVuYywgd2FpdCwgb3B0aW9ucykge1xuICAgIHZhciBjb250ZXh0LCBhcmdzLCByZXN1bHQ7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIHZhciBwcmV2aW91cyA9IDA7XG4gICAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge307XG4gICAgdmFyIGxhdGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICBwcmV2aW91cyA9IG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UgPyAwIDogXy5ub3coKTtcbiAgICAgIHRpbWVvdXQgPSBudWxsO1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgIH07XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5vdyA9IF8ubm93KCk7XG4gICAgICBpZiAoIXByZXZpb3VzICYmIG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UpIHByZXZpb3VzID0gbm93O1xuICAgICAgdmFyIHJlbWFpbmluZyA9IHdhaXQgLSAobm93IC0gcHJldmlvdXMpO1xuICAgICAgY29udGV4dCA9IHRoaXM7XG4gICAgICBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHJlbWFpbmluZyA8PSAwIHx8IHJlbWFpbmluZyA+IHdhaXQpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgICAgcHJldmlvdXMgPSBub3c7XG4gICAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmICghdGltZW91dCAmJiBvcHRpb25zLnRyYWlsaW5nICE9PSBmYWxzZSkge1xuICAgICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChsYXRlciwgcmVtYWluaW5nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24sIHRoYXQsIGFzIGxvbmcgYXMgaXQgY29udGludWVzIHRvIGJlIGludm9rZWQsIHdpbGwgbm90XG4gIC8vIGJlIHRyaWdnZXJlZC4gVGhlIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGl0IHN0b3BzIGJlaW5nIGNhbGxlZCBmb3JcbiAgLy8gTiBtaWxsaXNlY29uZHMuIElmIGBpbW1lZGlhdGVgIGlzIHBhc3NlZCwgdHJpZ2dlciB0aGUgZnVuY3Rpb24gb24gdGhlXG4gIC8vIGxlYWRpbmcgZWRnZSwgaW5zdGVhZCBvZiB0aGUgdHJhaWxpbmcuXG4gIF8uZGVib3VuY2UgPSBmdW5jdGlvbihmdW5jLCB3YWl0LCBpbW1lZGlhdGUpIHtcbiAgICB2YXIgdGltZW91dCwgYXJncywgY29udGV4dCwgdGltZXN0YW1wLCByZXN1bHQ7XG5cbiAgICB2YXIgbGF0ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBsYXN0ID0gXy5ub3coKSAtIHRpbWVzdGFtcDtcblxuICAgICAgaWYgKGxhc3QgPCB3YWl0ICYmIGxhc3QgPiAwKSB7XG4gICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGxhdGVyLCB3YWl0IC0gbGFzdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgICAgaWYgKCFpbW1lZGlhdGUpIHtcbiAgICAgICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIGNvbnRleHQgPSB0aGlzO1xuICAgICAgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHRpbWVzdGFtcCA9IF8ubm93KCk7XG4gICAgICB2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcbiAgICAgIGlmICghdGltZW91dCkgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQpO1xuICAgICAgaWYgKGNhbGxOb3cpIHtcbiAgICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgICAgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyB0aGUgZmlyc3QgZnVuY3Rpb24gcGFzc2VkIGFzIGFuIGFyZ3VtZW50IHRvIHRoZSBzZWNvbmQsXG4gIC8vIGFsbG93aW5nIHlvdSB0byBhZGp1c3QgYXJndW1lbnRzLCBydW4gY29kZSBiZWZvcmUgYW5kIGFmdGVyLCBhbmRcbiAgLy8gY29uZGl0aW9uYWxseSBleGVjdXRlIHRoZSBvcmlnaW5hbCBmdW5jdGlvbi5cbiAgXy53cmFwID0gZnVuY3Rpb24oZnVuYywgd3JhcHBlcikge1xuICAgIHJldHVybiBfLnBhcnRpYWwod3JhcHBlciwgZnVuYyk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIG5lZ2F0ZWQgdmVyc2lvbiBvZiB0aGUgcGFzc2VkLWluIHByZWRpY2F0ZS5cbiAgXy5uZWdhdGUgPSBmdW5jdGlvbihwcmVkaWNhdGUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gIXByZWRpY2F0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgaXMgdGhlIGNvbXBvc2l0aW9uIG9mIGEgbGlzdCBvZiBmdW5jdGlvbnMsIGVhY2hcbiAgLy8gY29uc3VtaW5nIHRoZSByZXR1cm4gdmFsdWUgb2YgdGhlIGZ1bmN0aW9uIHRoYXQgZm9sbG93cy5cbiAgXy5jb21wb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgdmFyIHN0YXJ0ID0gYXJncy5sZW5ndGggLSAxO1xuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBpID0gc3RhcnQ7XG4gICAgICB2YXIgcmVzdWx0ID0gYXJnc1tzdGFydF0uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIHdoaWxlIChpLS0pIHJlc3VsdCA9IGFyZ3NbaV0uY2FsbCh0aGlzLCByZXN1bHQpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBmdW5jdGlvbiB0aGF0IHdpbGwgb25seSBiZSBleGVjdXRlZCBhZnRlciBiZWluZyBjYWxsZWQgTiB0aW1lcy5cbiAgXy5hZnRlciA9IGZ1bmN0aW9uKHRpbWVzLCBmdW5jKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKC0tdGltZXMgPCAxKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB3aWxsIG9ubHkgYmUgZXhlY3V0ZWQgYmVmb3JlIGJlaW5nIGNhbGxlZCBOIHRpbWVzLlxuICBfLmJlZm9yZSA9IGZ1bmN0aW9uKHRpbWVzLCBmdW5jKSB7XG4gICAgdmFyIG1lbW87XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKC0tdGltZXMgPiAwKSB7XG4gICAgICAgIG1lbW8gPSBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmdW5jID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtZW1vO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBleGVjdXRlZCBhdCBtb3N0IG9uZSB0aW1lLCBubyBtYXR0ZXIgaG93XG4gIC8vIG9mdGVuIHlvdSBjYWxsIGl0LiBVc2VmdWwgZm9yIGxhenkgaW5pdGlhbGl6YXRpb24uXG4gIF8ub25jZSA9IF8ucGFydGlhbChfLmJlZm9yZSwgMik7XG5cbiAgLy8gT2JqZWN0IEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gUmV0cmlldmUgdGhlIG5hbWVzIG9mIGFuIG9iamVjdCdzIHByb3BlcnRpZXMuXG4gIC8vIERlbGVnYXRlcyB0byAqKkVDTUFTY3JpcHQgNSoqJ3MgbmF0aXZlIGBPYmplY3Qua2V5c2BcbiAgXy5rZXlzID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKCFfLmlzT2JqZWN0KG9iaikpIHJldHVybiBbXTtcbiAgICBpZiAobmF0aXZlS2V5cykgcmV0dXJuIG5hdGl2ZUtleXMob2JqKTtcbiAgICB2YXIga2V5cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBvYmopIGlmIChfLmhhcyhvYmosIGtleSkpIGtleXMucHVzaChrZXkpO1xuICAgIHJldHVybiBrZXlzO1xuICB9O1xuXG4gIC8vIFJldHJpZXZlIHRoZSB2YWx1ZXMgb2YgYW4gb2JqZWN0J3MgcHJvcGVydGllcy5cbiAgXy52YWx1ZXMgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIga2V5cyA9IF8ua2V5cyhvYmopO1xuICAgIHZhciBsZW5ndGggPSBrZXlzLmxlbmd0aDtcbiAgICB2YXIgdmFsdWVzID0gQXJyYXkobGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YWx1ZXNbaV0gPSBvYmpba2V5c1tpXV07XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZXM7XG4gIH07XG5cbiAgLy8gQ29udmVydCBhbiBvYmplY3QgaW50byBhIGxpc3Qgb2YgYFtrZXksIHZhbHVlXWAgcGFpcnMuXG4gIF8ucGFpcnMgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIga2V5cyA9IF8ua2V5cyhvYmopO1xuICAgIHZhciBsZW5ndGggPSBrZXlzLmxlbmd0aDtcbiAgICB2YXIgcGFpcnMgPSBBcnJheShsZW5ndGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHBhaXJzW2ldID0gW2tleXNbaV0sIG9ialtrZXlzW2ldXV07XG4gICAgfVxuICAgIHJldHVybiBwYWlycztcbiAgfTtcblxuICAvLyBJbnZlcnQgdGhlIGtleXMgYW5kIHZhbHVlcyBvZiBhbiBvYmplY3QuIFRoZSB2YWx1ZXMgbXVzdCBiZSBzZXJpYWxpemFibGUuXG4gIF8uaW52ZXJ0ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGtleXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlc3VsdFtvYmpba2V5c1tpXV1dID0ga2V5c1tpXTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBSZXR1cm4gYSBzb3J0ZWQgbGlzdCBvZiB0aGUgZnVuY3Rpb24gbmFtZXMgYXZhaWxhYmxlIG9uIHRoZSBvYmplY3QuXG4gIC8vIEFsaWFzZWQgYXMgYG1ldGhvZHNgXG4gIF8uZnVuY3Rpb25zID0gXy5tZXRob2RzID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIG5hbWVzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihvYmpba2V5XSkpIG5hbWVzLnB1c2goa2V5KTtcbiAgICB9XG4gICAgcmV0dXJuIG5hbWVzLnNvcnQoKTtcbiAgfTtcblxuICAvLyBFeHRlbmQgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIHByb3BlcnRpZXMgaW4gcGFzc2VkLWluIG9iamVjdChzKS5cbiAgXy5leHRlbmQgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIV8uaXNPYmplY3Qob2JqKSkgcmV0dXJuIG9iajtcbiAgICB2YXIgc291cmNlLCBwcm9wO1xuICAgIGZvciAodmFyIGkgPSAxLCBsZW5ndGggPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHNvdXJjZSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgIGZvciAocHJvcCBpbiBzb3VyY2UpIHtcbiAgICAgICAgaWYgKGhhc093blByb3BlcnR5LmNhbGwoc291cmNlLCBwcm9wKSkge1xuICAgICAgICAgICAgb2JqW3Byb3BdID0gc291cmNlW3Byb3BdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvYmo7XG4gIH07XG5cbiAgLy8gUmV0dXJuIGEgY29weSBvZiB0aGUgb2JqZWN0IG9ubHkgY29udGFpbmluZyB0aGUgd2hpdGVsaXN0ZWQgcHJvcGVydGllcy5cbiAgXy5waWNrID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIHZhciByZXN1bHQgPSB7fSwga2V5O1xuICAgIGlmIChvYmogPT0gbnVsbCkgcmV0dXJuIHJlc3VsdDtcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGl0ZXJhdGVlKSkge1xuICAgICAgaXRlcmF0ZWUgPSBjcmVhdGVDYWxsYmFjayhpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgICBmb3IgKGtleSBpbiBvYmopIHtcbiAgICAgICAgdmFyIHZhbHVlID0gb2JqW2tleV07XG4gICAgICAgIGlmIChpdGVyYXRlZSh2YWx1ZSwga2V5LCBvYmopKSByZXN1bHRba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIga2V5cyA9IGNvbmNhdC5hcHBseShbXSwgc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKTtcbiAgICAgIG9iaiA9IG5ldyBPYmplY3Qob2JqKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBrZXlzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGtleSA9IGtleXNbaV07XG4gICAgICAgIGlmIChrZXkgaW4gb2JqKSByZXN1bHRba2V5XSA9IG9ialtrZXldO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gICAvLyBSZXR1cm4gYSBjb3B5IG9mIHRoZSBvYmplY3Qgd2l0aG91dCB0aGUgYmxhY2tsaXN0ZWQgcHJvcGVydGllcy5cbiAgXy5vbWl0ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIGlmIChfLmlzRnVuY3Rpb24oaXRlcmF0ZWUpKSB7XG4gICAgICBpdGVyYXRlZSA9IF8ubmVnYXRlKGl0ZXJhdGVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGtleXMgPSBfLm1hcChjb25jYXQuYXBwbHkoW10sIHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSksIFN0cmluZyk7XG4gICAgICBpdGVyYXRlZSA9IGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuICFfLmNvbnRhaW5zKGtleXMsIGtleSk7XG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gXy5waWNrKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpO1xuICB9O1xuXG4gIC8vIEZpbGwgaW4gYSBnaXZlbiBvYmplY3Qgd2l0aCBkZWZhdWx0IHByb3BlcnRpZXMuXG4gIF8uZGVmYXVsdHMgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIV8uaXNPYmplY3Qob2JqKSkgcmV0dXJuIG9iajtcbiAgICBmb3IgKHZhciBpID0gMSwgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgc291cmNlID0gYXJndW1lbnRzW2ldO1xuICAgICAgZm9yICh2YXIgcHJvcCBpbiBzb3VyY2UpIHtcbiAgICAgICAgaWYgKG9ialtwcm9wXSA9PT0gdm9pZCAwKSBvYmpbcHJvcF0gPSBzb3VyY2VbcHJvcF07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvYmo7XG4gIH07XG5cbiAgLy8gQ3JlYXRlIGEgKHNoYWxsb3ctY2xvbmVkKSBkdXBsaWNhdGUgb2YgYW4gb2JqZWN0LlxuICBfLmNsb25lID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKCFfLmlzT2JqZWN0KG9iaikpIHJldHVybiBvYmo7XG4gICAgcmV0dXJuIF8uaXNBcnJheShvYmopID8gb2JqLnNsaWNlKCkgOiBfLmV4dGVuZCh7fSwgb2JqKTtcbiAgfTtcblxuICAvLyBJbnZva2VzIGludGVyY2VwdG9yIHdpdGggdGhlIG9iaiwgYW5kIHRoZW4gcmV0dXJucyBvYmouXG4gIC8vIFRoZSBwcmltYXJ5IHB1cnBvc2Ugb2YgdGhpcyBtZXRob2QgaXMgdG8gXCJ0YXAgaW50b1wiIGEgbWV0aG9kIGNoYWluLCBpblxuICAvLyBvcmRlciB0byBwZXJmb3JtIG9wZXJhdGlvbnMgb24gaW50ZXJtZWRpYXRlIHJlc3VsdHMgd2l0aGluIHRoZSBjaGFpbi5cbiAgXy50YXAgPSBmdW5jdGlvbihvYmosIGludGVyY2VwdG9yKSB7XG4gICAgaW50ZXJjZXB0b3Iob2JqKTtcbiAgICByZXR1cm4gb2JqO1xuICB9O1xuXG4gIC8vIEludGVybmFsIHJlY3Vyc2l2ZSBjb21wYXJpc29uIGZ1bmN0aW9uIGZvciBgaXNFcXVhbGAuXG4gIHZhciBlcSA9IGZ1bmN0aW9uKGEsIGIsIGFTdGFjaywgYlN0YWNrKSB7XG4gICAgLy8gSWRlbnRpY2FsIG9iamVjdHMgYXJlIGVxdWFsLiBgMCA9PT0gLTBgLCBidXQgdGhleSBhcmVuJ3QgaWRlbnRpY2FsLlxuICAgIC8vIFNlZSB0aGUgW0hhcm1vbnkgYGVnYWxgIHByb3Bvc2FsXShodHRwOi8vd2lraS5lY21hc2NyaXB0Lm9yZy9kb2t1LnBocD9pZD1oYXJtb255OmVnYWwpLlxuICAgIGlmIChhID09PSBiKSByZXR1cm4gYSAhPT0gMCB8fCAxIC8gYSA9PT0gMSAvIGI7XG4gICAgLy8gQSBzdHJpY3QgY29tcGFyaXNvbiBpcyBuZWNlc3NhcnkgYmVjYXVzZSBgbnVsbCA9PSB1bmRlZmluZWRgLlxuICAgIGlmIChhID09IG51bGwgfHwgYiA9PSBudWxsKSByZXR1cm4gYSA9PT0gYjtcbiAgICAvLyBVbndyYXAgYW55IHdyYXBwZWQgb2JqZWN0cy5cbiAgICBpZiAoYSBpbnN0YW5jZW9mIF8pIGEgPSBhLl93cmFwcGVkO1xuICAgIGlmIChiIGluc3RhbmNlb2YgXykgYiA9IGIuX3dyYXBwZWQ7XG4gICAgLy8gQ29tcGFyZSBgW1tDbGFzc11dYCBuYW1lcy5cbiAgICB2YXIgY2xhc3NOYW1lID0gdG9TdHJpbmcuY2FsbChhKTtcbiAgICBpZiAoY2xhc3NOYW1lICE9PSB0b1N0cmluZy5jYWxsKGIpKSByZXR1cm4gZmFsc2U7XG4gICAgc3dpdGNoIChjbGFzc05hbWUpIHtcbiAgICAgIC8vIFN0cmluZ3MsIG51bWJlcnMsIHJlZ3VsYXIgZXhwcmVzc2lvbnMsIGRhdGVzLCBhbmQgYm9vbGVhbnMgYXJlIGNvbXBhcmVkIGJ5IHZhbHVlLlxuICAgICAgY2FzZSAnW29iamVjdCBSZWdFeHBdJzpcbiAgICAgIC8vIFJlZ0V4cHMgYXJlIGNvZXJjZWQgdG8gc3RyaW5ncyBmb3IgY29tcGFyaXNvbiAoTm90ZTogJycgKyAvYS9pID09PSAnL2EvaScpXG4gICAgICBjYXNlICdbb2JqZWN0IFN0cmluZ10nOlxuICAgICAgICAvLyBQcmltaXRpdmVzIGFuZCB0aGVpciBjb3JyZXNwb25kaW5nIG9iamVjdCB3cmFwcGVycyBhcmUgZXF1aXZhbGVudDsgdGh1cywgYFwiNVwiYCBpc1xuICAgICAgICAvLyBlcXVpdmFsZW50IHRvIGBuZXcgU3RyaW5nKFwiNVwiKWAuXG4gICAgICAgIHJldHVybiAnJyArIGEgPT09ICcnICsgYjtcbiAgICAgIGNhc2UgJ1tvYmplY3QgTnVtYmVyXSc6XG4gICAgICAgIC8vIGBOYU5gcyBhcmUgZXF1aXZhbGVudCwgYnV0IG5vbi1yZWZsZXhpdmUuXG4gICAgICAgIC8vIE9iamVjdChOYU4pIGlzIGVxdWl2YWxlbnQgdG8gTmFOXG4gICAgICAgIGlmICgrYSAhPT0gK2EpIHJldHVybiArYiAhPT0gK2I7XG4gICAgICAgIC8vIEFuIGBlZ2FsYCBjb21wYXJpc29uIGlzIHBlcmZvcm1lZCBmb3Igb3RoZXIgbnVtZXJpYyB2YWx1ZXMuXG4gICAgICAgIHJldHVybiArYSA9PT0gMCA/IDEgLyArYSA9PT0gMSAvIGIgOiArYSA9PT0gK2I7XG4gICAgICBjYXNlICdbb2JqZWN0IERhdGVdJzpcbiAgICAgIGNhc2UgJ1tvYmplY3QgQm9vbGVhbl0nOlxuICAgICAgICAvLyBDb2VyY2UgZGF0ZXMgYW5kIGJvb2xlYW5zIHRvIG51bWVyaWMgcHJpbWl0aXZlIHZhbHVlcy4gRGF0ZXMgYXJlIGNvbXBhcmVkIGJ5IHRoZWlyXG4gICAgICAgIC8vIG1pbGxpc2Vjb25kIHJlcHJlc2VudGF0aW9ucy4gTm90ZSB0aGF0IGludmFsaWQgZGF0ZXMgd2l0aCBtaWxsaXNlY29uZCByZXByZXNlbnRhdGlvbnNcbiAgICAgICAgLy8gb2YgYE5hTmAgYXJlIG5vdCBlcXVpdmFsZW50LlxuICAgICAgICByZXR1cm4gK2EgPT09ICtiO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGEgIT0gJ29iamVjdCcgfHwgdHlwZW9mIGIgIT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcbiAgICAvLyBBc3N1bWUgZXF1YWxpdHkgZm9yIGN5Y2xpYyBzdHJ1Y3R1cmVzLiBUaGUgYWxnb3JpdGhtIGZvciBkZXRlY3RpbmcgY3ljbGljXG4gICAgLy8gc3RydWN0dXJlcyBpcyBhZGFwdGVkIGZyb20gRVMgNS4xIHNlY3Rpb24gMTUuMTIuMywgYWJzdHJhY3Qgb3BlcmF0aW9uIGBKT2AuXG4gICAgdmFyIGxlbmd0aCA9IGFTdGFjay5sZW5ndGg7XG4gICAgd2hpbGUgKGxlbmd0aC0tKSB7XG4gICAgICAvLyBMaW5lYXIgc2VhcmNoLiBQZXJmb3JtYW5jZSBpcyBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIHRoZSBudW1iZXIgb2ZcbiAgICAgIC8vIHVuaXF1ZSBuZXN0ZWQgc3RydWN0dXJlcy5cbiAgICAgIGlmIChhU3RhY2tbbGVuZ3RoXSA9PT0gYSkgcmV0dXJuIGJTdGFja1tsZW5ndGhdID09PSBiO1xuICAgIH1cbiAgICAvLyBPYmplY3RzIHdpdGggZGlmZmVyZW50IGNvbnN0cnVjdG9ycyBhcmUgbm90IGVxdWl2YWxlbnQsIGJ1dCBgT2JqZWN0YHNcbiAgICAvLyBmcm9tIGRpZmZlcmVudCBmcmFtZXMgYXJlLlxuICAgIHZhciBhQ3RvciA9IGEuY29uc3RydWN0b3IsIGJDdG9yID0gYi5jb25zdHJ1Y3RvcjtcbiAgICBpZiAoXG4gICAgICBhQ3RvciAhPT0gYkN0b3IgJiZcbiAgICAgIC8vIEhhbmRsZSBPYmplY3QuY3JlYXRlKHgpIGNhc2VzXG4gICAgICAnY29uc3RydWN0b3InIGluIGEgJiYgJ2NvbnN0cnVjdG9yJyBpbiBiICYmXG4gICAgICAhKF8uaXNGdW5jdGlvbihhQ3RvcikgJiYgYUN0b3IgaW5zdGFuY2VvZiBhQ3RvciAmJlxuICAgICAgICBfLmlzRnVuY3Rpb24oYkN0b3IpICYmIGJDdG9yIGluc3RhbmNlb2YgYkN0b3IpXG4gICAgKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIC8vIEFkZCB0aGUgZmlyc3Qgb2JqZWN0IHRvIHRoZSBzdGFjayBvZiB0cmF2ZXJzZWQgb2JqZWN0cy5cbiAgICBhU3RhY2sucHVzaChhKTtcbiAgICBiU3RhY2sucHVzaChiKTtcbiAgICB2YXIgc2l6ZSwgcmVzdWx0O1xuICAgIC8vIFJlY3Vyc2l2ZWx5IGNvbXBhcmUgb2JqZWN0cyBhbmQgYXJyYXlzLlxuICAgIGlmIChjbGFzc05hbWUgPT09ICdbb2JqZWN0IEFycmF5XScpIHtcbiAgICAgIC8vIENvbXBhcmUgYXJyYXkgbGVuZ3RocyB0byBkZXRlcm1pbmUgaWYgYSBkZWVwIGNvbXBhcmlzb24gaXMgbmVjZXNzYXJ5LlxuICAgICAgc2l6ZSA9IGEubGVuZ3RoO1xuICAgICAgcmVzdWx0ID0gc2l6ZSA9PT0gYi5sZW5ndGg7XG4gICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgIC8vIERlZXAgY29tcGFyZSB0aGUgY29udGVudHMsIGlnbm9yaW5nIG5vbi1udW1lcmljIHByb3BlcnRpZXMuXG4gICAgICAgIHdoaWxlIChzaXplLS0pIHtcbiAgICAgICAgICBpZiAoIShyZXN1bHQgPSBlcShhW3NpemVdLCBiW3NpemVdLCBhU3RhY2ssIGJTdGFjaykpKSBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBEZWVwIGNvbXBhcmUgb2JqZWN0cy5cbiAgICAgIHZhciBrZXlzID0gXy5rZXlzKGEpLCBrZXk7XG4gICAgICBzaXplID0ga2V5cy5sZW5ndGg7XG4gICAgICAvLyBFbnN1cmUgdGhhdCBib3RoIG9iamVjdHMgY29udGFpbiB0aGUgc2FtZSBudW1iZXIgb2YgcHJvcGVydGllcyBiZWZvcmUgY29tcGFyaW5nIGRlZXAgZXF1YWxpdHkuXG4gICAgICByZXN1bHQgPSBfLmtleXMoYikubGVuZ3RoID09PSBzaXplO1xuICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICB3aGlsZSAoc2l6ZS0tKSB7XG4gICAgICAgICAgLy8gRGVlcCBjb21wYXJlIGVhY2ggbWVtYmVyXG4gICAgICAgICAga2V5ID0ga2V5c1tzaXplXTtcbiAgICAgICAgICBpZiAoIShyZXN1bHQgPSBfLmhhcyhiLCBrZXkpICYmIGVxKGFba2V5XSwgYltrZXldLCBhU3RhY2ssIGJTdGFjaykpKSBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBSZW1vdmUgdGhlIGZpcnN0IG9iamVjdCBmcm9tIHRoZSBzdGFjayBvZiB0cmF2ZXJzZWQgb2JqZWN0cy5cbiAgICBhU3RhY2sucG9wKCk7XG4gICAgYlN0YWNrLnBvcCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gUGVyZm9ybSBhIGRlZXAgY29tcGFyaXNvbiB0byBjaGVjayBpZiB0d28gb2JqZWN0cyBhcmUgZXF1YWwuXG4gIF8uaXNFcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gZXEoYSwgYiwgW10sIFtdKTtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIGFycmF5LCBzdHJpbmcsIG9yIG9iamVjdCBlbXB0eT9cbiAgLy8gQW4gXCJlbXB0eVwiIG9iamVjdCBoYXMgbm8gZW51bWVyYWJsZSBvd24tcHJvcGVydGllcy5cbiAgXy5pc0VtcHR5ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoXy5pc0FycmF5KG9iaikgfHwgXy5pc1N0cmluZyhvYmopIHx8IF8uaXNBcmd1bWVudHMob2JqKSkgcmV0dXJuIG9iai5sZW5ndGggPT09IDA7XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikgaWYgKF8uaGFzKG9iaiwga2V5KSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gdmFsdWUgYSBET00gZWxlbWVudD9cbiAgXy5pc0VsZW1lbnQgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gISEob2JqICYmIG9iai5ub2RlVHlwZSA9PT0gMSk7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YWx1ZSBhbiBhcnJheT9cbiAgLy8gRGVsZWdhdGVzIHRvIEVDTUE1J3MgbmF0aXZlIEFycmF5LmlzQXJyYXlcbiAgXy5pc0FycmF5ID0gbmF0aXZlSXNBcnJheSB8fCBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gdG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gdmFyaWFibGUgYW4gb2JqZWN0P1xuICBfLmlzT2JqZWN0ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIHR5cGUgPSB0eXBlb2Ygb2JqO1xuICAgIHJldHVybiB0eXBlID09PSAnZnVuY3Rpb24nIHx8IHR5cGUgPT09ICdvYmplY3QnICYmICEhb2JqO1xuICB9O1xuXG4gIC8vIEFkZCBzb21lIGlzVHlwZSBtZXRob2RzOiBpc0FyZ3VtZW50cywgaXNGdW5jdGlvbiwgaXNTdHJpbmcsIGlzTnVtYmVyLCBpc0RhdGUsIGlzUmVnRXhwLlxuICBfLmVhY2goWydBcmd1bWVudHMnLCAnRnVuY3Rpb24nLCAnU3RyaW5nJywgJ051bWJlcicsICdEYXRlJywgJ1JlZ0V4cCddLCBmdW5jdGlvbihuYW1lKSB7XG4gICAgX1snaXMnICsgbmFtZV0gPSBmdW5jdGlvbihvYmopIHtcbiAgICAgIHJldHVybiB0b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0ICcgKyBuYW1lICsgJ10nO1xuICAgIH07XG4gIH0pO1xuXG4gIC8vIERlZmluZSBhIGZhbGxiYWNrIHZlcnNpb24gb2YgdGhlIG1ldGhvZCBpbiBicm93c2VycyAoYWhlbSwgSUUpLCB3aGVyZVxuICAvLyB0aGVyZSBpc24ndCBhbnkgaW5zcGVjdGFibGUgXCJBcmd1bWVudHNcIiB0eXBlLlxuICBpZiAoIV8uaXNBcmd1bWVudHMoYXJndW1lbnRzKSkge1xuICAgIF8uaXNBcmd1bWVudHMgPSBmdW5jdGlvbihvYmopIHtcbiAgICAgIHJldHVybiBfLmhhcyhvYmosICdjYWxsZWUnKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gT3B0aW1pemUgYGlzRnVuY3Rpb25gIGlmIGFwcHJvcHJpYXRlLiBXb3JrIGFyb3VuZCBhbiBJRSAxMSBidWcuXG4gIGlmICh0eXBlb2YgLy4vICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgXy5pc0Z1bmN0aW9uID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PSAnZnVuY3Rpb24nIHx8IGZhbHNlO1xuICAgIH07XG4gIH1cblxuICAvLyBJcyBhIGdpdmVuIG9iamVjdCBhIGZpbml0ZSBudW1iZXI/XG4gIF8uaXNGaW5pdGUgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gaXNGaW5pdGUob2JqKSAmJiAhaXNOYU4ocGFyc2VGbG9hdChvYmopKTtcbiAgfTtcblxuICAvLyBJcyB0aGUgZ2l2ZW4gdmFsdWUgYE5hTmA/IChOYU4gaXMgdGhlIG9ubHkgbnVtYmVyIHdoaWNoIGRvZXMgbm90IGVxdWFsIGl0c2VsZikuXG4gIF8uaXNOYU4gPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gXy5pc051bWJlcihvYmopICYmIG9iaiAhPT0gK29iajtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIHZhbHVlIGEgYm9vbGVhbj9cbiAgXy5pc0Jvb2xlYW4gPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gb2JqID09PSB0cnVlIHx8IG9iaiA9PT0gZmFsc2UgfHwgdG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBCb29sZWFuXSc7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YWx1ZSBlcXVhbCB0byBudWxsP1xuICBfLmlzTnVsbCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiBvYmogPT09IG51bGw7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YXJpYWJsZSB1bmRlZmluZWQ/XG4gIF8uaXNVbmRlZmluZWQgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gb2JqID09PSB2b2lkIDA7XG4gIH07XG5cbiAgLy8gU2hvcnRjdXQgZnVuY3Rpb24gZm9yIGNoZWNraW5nIGlmIGFuIG9iamVjdCBoYXMgYSBnaXZlbiBwcm9wZXJ0eSBkaXJlY3RseVxuICAvLyBvbiBpdHNlbGYgKGluIG90aGVyIHdvcmRzLCBub3Qgb24gYSBwcm90b3R5cGUpLlxuICBfLmhhcyA9IGZ1bmN0aW9uKG9iaiwga2V5KSB7XG4gICAgcmV0dXJuIG9iaiAhPSBudWxsICYmIGhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpO1xuICB9O1xuXG4gIC8vIFV0aWxpdHkgRnVuY3Rpb25zXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gUnVuIFVuZGVyc2NvcmUuanMgaW4gKm5vQ29uZmxpY3QqIG1vZGUsIHJldHVybmluZyB0aGUgYF9gIHZhcmlhYmxlIHRvIGl0c1xuICAvLyBwcmV2aW91cyBvd25lci4gUmV0dXJucyBhIHJlZmVyZW5jZSB0byB0aGUgVW5kZXJzY29yZSBvYmplY3QuXG4gIF8ubm9Db25mbGljdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJvb3QuXyA9IHByZXZpb3VzVW5kZXJzY29yZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICAvLyBLZWVwIHRoZSBpZGVudGl0eSBmdW5jdGlvbiBhcm91bmQgZm9yIGRlZmF1bHQgaXRlcmF0ZWVzLlxuICBfLmlkZW50aXR5ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG5cbiAgXy5jb25zdGFudCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH07XG4gIH07XG5cbiAgXy5ub29wID0gZnVuY3Rpb24oKXt9O1xuXG4gIF8ucHJvcGVydHkgPSBmdW5jdGlvbihrZXkpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gb2JqW2tleV07XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgcHJlZGljYXRlIGZvciBjaGVja2luZyB3aGV0aGVyIGFuIG9iamVjdCBoYXMgYSBnaXZlbiBzZXQgb2YgYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8ubWF0Y2hlcyA9IGZ1bmN0aW9uKGF0dHJzKSB7XG4gICAgdmFyIHBhaXJzID0gXy5wYWlycyhhdHRycyksIGxlbmd0aCA9IHBhaXJzLmxlbmd0aDtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqKSB7XG4gICAgICBpZiAob2JqID09IG51bGwpIHJldHVybiAhbGVuZ3RoO1xuICAgICAgb2JqID0gbmV3IE9iamVjdChvYmopO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgcGFpciA9IHBhaXJzW2ldLCBrZXkgPSBwYWlyWzBdO1xuICAgICAgICBpZiAocGFpclsxXSAhPT0gb2JqW2tleV0gfHwgIShrZXkgaW4gb2JqKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfTtcbiAgfTtcblxuICAvLyBSdW4gYSBmdW5jdGlvbiAqKm4qKiB0aW1lcy5cbiAgXy50aW1lcyA9IGZ1bmN0aW9uKG4sIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgdmFyIGFjY3VtID0gQXJyYXkoTWF0aC5tYXgoMCwgbikpO1xuICAgIGl0ZXJhdGVlID0gY3JlYXRlQ2FsbGJhY2soaXRlcmF0ZWUsIGNvbnRleHQsIDEpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbjsgaSsrKSBhY2N1bVtpXSA9IGl0ZXJhdGVlKGkpO1xuICAgIHJldHVybiBhY2N1bTtcbiAgfTtcblxuICAvLyBSZXR1cm4gYSByYW5kb20gaW50ZWdlciBiZXR3ZWVuIG1pbiBhbmQgbWF4IChpbmNsdXNpdmUpLlxuICBfLnJhbmRvbSA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgaWYgKG1heCA9PSBudWxsKSB7XG4gICAgICBtYXggPSBtaW47XG4gICAgICBtaW4gPSAwO1xuICAgIH1cbiAgICByZXR1cm4gbWluICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbiArIDEpKTtcbiAgfTtcblxuICAvLyBBIChwb3NzaWJseSBmYXN0ZXIpIHdheSB0byBnZXQgdGhlIGN1cnJlbnQgdGltZXN0YW1wIGFzIGFuIGludGVnZXIuXG4gIF8ubm93ID0gRGF0ZS5ub3cgfHwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICB9O1xuXG4gICAvLyBMaXN0IG9mIEhUTUwgZW50aXRpZXMgZm9yIGVzY2FwaW5nLlxuICB2YXIgZXNjYXBlTWFwID0ge1xuICAgICcmJzogJyZhbXA7JyxcbiAgICAnPCc6ICcmbHQ7JyxcbiAgICAnPic6ICcmZ3Q7JyxcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjeDI3OycsXG4gICAgJ2AnOiAnJiN4NjA7J1xuICB9O1xuICB2YXIgdW5lc2NhcGVNYXAgPSBfLmludmVydChlc2NhcGVNYXApO1xuXG4gIC8vIEZ1bmN0aW9ucyBmb3IgZXNjYXBpbmcgYW5kIHVuZXNjYXBpbmcgc3RyaW5ncyB0by9mcm9tIEhUTUwgaW50ZXJwb2xhdGlvbi5cbiAgdmFyIGNyZWF0ZUVzY2FwZXIgPSBmdW5jdGlvbihtYXApIHtcbiAgICB2YXIgZXNjYXBlciA9IGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgICByZXR1cm4gbWFwW21hdGNoXTtcbiAgICB9O1xuICAgIC8vIFJlZ2V4ZXMgZm9yIGlkZW50aWZ5aW5nIGEga2V5IHRoYXQgbmVlZHMgdG8gYmUgZXNjYXBlZFxuICAgIHZhciBzb3VyY2UgPSAnKD86JyArIF8ua2V5cyhtYXApLmpvaW4oJ3wnKSArICcpJztcbiAgICB2YXIgdGVzdFJlZ2V4cCA9IFJlZ0V4cChzb3VyY2UpO1xuICAgIHZhciByZXBsYWNlUmVnZXhwID0gUmVnRXhwKHNvdXJjZSwgJ2cnKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oc3RyaW5nKSB7XG4gICAgICBzdHJpbmcgPSBzdHJpbmcgPT0gbnVsbCA/ICcnIDogJycgKyBzdHJpbmc7XG4gICAgICByZXR1cm4gdGVzdFJlZ2V4cC50ZXN0KHN0cmluZykgPyBzdHJpbmcucmVwbGFjZShyZXBsYWNlUmVnZXhwLCBlc2NhcGVyKSA6IHN0cmluZztcbiAgICB9O1xuICB9O1xuICBfLmVzY2FwZSA9IGNyZWF0ZUVzY2FwZXIoZXNjYXBlTWFwKTtcbiAgXy51bmVzY2FwZSA9IGNyZWF0ZUVzY2FwZXIodW5lc2NhcGVNYXApO1xuXG4gIC8vIElmIHRoZSB2YWx1ZSBvZiB0aGUgbmFtZWQgYHByb3BlcnR5YCBpcyBhIGZ1bmN0aW9uIHRoZW4gaW52b2tlIGl0IHdpdGggdGhlXG4gIC8vIGBvYmplY3RgIGFzIGNvbnRleHQ7IG90aGVyd2lzZSwgcmV0dXJuIGl0LlxuICBfLnJlc3VsdCA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHkpIHtcbiAgICBpZiAob2JqZWN0ID09IG51bGwpIHJldHVybiB2b2lkIDA7XG4gICAgdmFyIHZhbHVlID0gb2JqZWN0W3Byb3BlcnR5XTtcbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKHZhbHVlKSA/IG9iamVjdFtwcm9wZXJ0eV0oKSA6IHZhbHVlO1xuICB9O1xuXG4gIC8vIEdlbmVyYXRlIGEgdW5pcXVlIGludGVnZXIgaWQgKHVuaXF1ZSB3aXRoaW4gdGhlIGVudGlyZSBjbGllbnQgc2Vzc2lvbikuXG4gIC8vIFVzZWZ1bCBmb3IgdGVtcG9yYXJ5IERPTSBpZHMuXG4gIHZhciBpZENvdW50ZXIgPSAwO1xuICBfLnVuaXF1ZUlkID0gZnVuY3Rpb24ocHJlZml4KSB7XG4gICAgdmFyIGlkID0gKytpZENvdW50ZXIgKyAnJztcbiAgICByZXR1cm4gcHJlZml4ID8gcHJlZml4ICsgaWQgOiBpZDtcbiAgfTtcblxuICAvLyBCeSBkZWZhdWx0LCBVbmRlcnNjb3JlIHVzZXMgRVJCLXN0eWxlIHRlbXBsYXRlIGRlbGltaXRlcnMsIGNoYW5nZSB0aGVcbiAgLy8gZm9sbG93aW5nIHRlbXBsYXRlIHNldHRpbmdzIHRvIHVzZSBhbHRlcm5hdGl2ZSBkZWxpbWl0ZXJzLlxuICBfLnRlbXBsYXRlU2V0dGluZ3MgPSB7XG4gICAgZXZhbHVhdGUgICAgOiAvPCUoW1xcc1xcU10rPyklPi9nLFxuICAgIGludGVycG9sYXRlIDogLzwlPShbXFxzXFxTXSs/KSU+L2csXG4gICAgZXNjYXBlICAgICAgOiAvPCUtKFtcXHNcXFNdKz8pJT4vZ1xuICB9O1xuXG4gIC8vIFdoZW4gY3VzdG9taXppbmcgYHRlbXBsYXRlU2V0dGluZ3NgLCBpZiB5b3UgZG9uJ3Qgd2FudCB0byBkZWZpbmUgYW5cbiAgLy8gaW50ZXJwb2xhdGlvbiwgZXZhbHVhdGlvbiBvciBlc2NhcGluZyByZWdleCwgd2UgbmVlZCBvbmUgdGhhdCBpc1xuICAvLyBndWFyYW50ZWVkIG5vdCB0byBtYXRjaC5cbiAgdmFyIG5vTWF0Y2ggPSAvKC4pXi87XG5cbiAgLy8gQ2VydGFpbiBjaGFyYWN0ZXJzIG5lZWQgdG8gYmUgZXNjYXBlZCBzbyB0aGF0IHRoZXkgY2FuIGJlIHB1dCBpbnRvIGFcbiAgLy8gc3RyaW5nIGxpdGVyYWwuXG4gIHZhciBlc2NhcGVzID0ge1xuICAgIFwiJ1wiOiAgICAgIFwiJ1wiLFxuICAgICdcXFxcJzogICAgICdcXFxcJyxcbiAgICAnXFxyJzogICAgICdyJyxcbiAgICAnXFxuJzogICAgICduJyxcbiAgICAnXFx1MjAyOCc6ICd1MjAyOCcsXG4gICAgJ1xcdTIwMjknOiAndTIwMjknXG4gIH07XG5cbiAgdmFyIGVzY2FwZXIgPSAvXFxcXHwnfFxccnxcXG58XFx1MjAyOHxcXHUyMDI5L2c7XG5cbiAgdmFyIGVzY2FwZUNoYXIgPSBmdW5jdGlvbihtYXRjaCkge1xuICAgIHJldHVybiAnXFxcXCcgKyBlc2NhcGVzW21hdGNoXTtcbiAgfTtcblxuICAvLyBKYXZhU2NyaXB0IG1pY3JvLXRlbXBsYXRpbmcsIHNpbWlsYXIgdG8gSm9obiBSZXNpZydzIGltcGxlbWVudGF0aW9uLlxuICAvLyBVbmRlcnNjb3JlIHRlbXBsYXRpbmcgaGFuZGxlcyBhcmJpdHJhcnkgZGVsaW1pdGVycywgcHJlc2VydmVzIHdoaXRlc3BhY2UsXG4gIC8vIGFuZCBjb3JyZWN0bHkgZXNjYXBlcyBxdW90ZXMgd2l0aGluIGludGVycG9sYXRlZCBjb2RlLlxuICAvLyBOQjogYG9sZFNldHRpbmdzYCBvbmx5IGV4aXN0cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkuXG4gIF8udGVtcGxhdGUgPSBmdW5jdGlvbih0ZXh0LCBzZXR0aW5ncywgb2xkU2V0dGluZ3MpIHtcbiAgICBpZiAoIXNldHRpbmdzICYmIG9sZFNldHRpbmdzKSBzZXR0aW5ncyA9IG9sZFNldHRpbmdzO1xuICAgIHNldHRpbmdzID0gXy5kZWZhdWx0cyh7fSwgc2V0dGluZ3MsIF8udGVtcGxhdGVTZXR0aW5ncyk7XG5cbiAgICAvLyBDb21iaW5lIGRlbGltaXRlcnMgaW50byBvbmUgcmVndWxhciBleHByZXNzaW9uIHZpYSBhbHRlcm5hdGlvbi5cbiAgICB2YXIgbWF0Y2hlciA9IFJlZ0V4cChbXG4gICAgICAoc2V0dGluZ3MuZXNjYXBlIHx8IG5vTWF0Y2gpLnNvdXJjZSxcbiAgICAgIChzZXR0aW5ncy5pbnRlcnBvbGF0ZSB8fCBub01hdGNoKS5zb3VyY2UsXG4gICAgICAoc2V0dGluZ3MuZXZhbHVhdGUgfHwgbm9NYXRjaCkuc291cmNlXG4gICAgXS5qb2luKCd8JykgKyAnfCQnLCAnZycpO1xuXG4gICAgLy8gQ29tcGlsZSB0aGUgdGVtcGxhdGUgc291cmNlLCBlc2NhcGluZyBzdHJpbmcgbGl0ZXJhbHMgYXBwcm9wcmlhdGVseS5cbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIHZhciBzb3VyY2UgPSBcIl9fcCs9J1wiO1xuICAgIHRleHQucmVwbGFjZShtYXRjaGVyLCBmdW5jdGlvbihtYXRjaCwgZXNjYXBlLCBpbnRlcnBvbGF0ZSwgZXZhbHVhdGUsIG9mZnNldCkge1xuICAgICAgc291cmNlICs9IHRleHQuc2xpY2UoaW5kZXgsIG9mZnNldCkucmVwbGFjZShlc2NhcGVyLCBlc2NhcGVDaGFyKTtcbiAgICAgIGluZGV4ID0gb2Zmc2V0ICsgbWF0Y2gubGVuZ3RoO1xuXG4gICAgICBpZiAoZXNjYXBlKSB7XG4gICAgICAgIHNvdXJjZSArPSBcIicrXFxuKChfX3Q9KFwiICsgZXNjYXBlICsgXCIpKT09bnVsbD8nJzpfLmVzY2FwZShfX3QpKStcXG4nXCI7XG4gICAgICB9IGVsc2UgaWYgKGludGVycG9sYXRlKSB7XG4gICAgICAgIHNvdXJjZSArPSBcIicrXFxuKChfX3Q9KFwiICsgaW50ZXJwb2xhdGUgKyBcIikpPT1udWxsPycnOl9fdCkrXFxuJ1wiO1xuICAgICAgfSBlbHNlIGlmIChldmFsdWF0ZSkge1xuICAgICAgICBzb3VyY2UgKz0gXCInO1xcblwiICsgZXZhbHVhdGUgKyBcIlxcbl9fcCs9J1wiO1xuICAgICAgfVxuXG4gICAgICAvLyBBZG9iZSBWTXMgbmVlZCB0aGUgbWF0Y2ggcmV0dXJuZWQgdG8gcHJvZHVjZSB0aGUgY29ycmVjdCBvZmZlc3QuXG4gICAgICByZXR1cm4gbWF0Y2g7XG4gICAgfSk7XG4gICAgc291cmNlICs9IFwiJztcXG5cIjtcblxuICAgIC8vIElmIGEgdmFyaWFibGUgaXMgbm90IHNwZWNpZmllZCwgcGxhY2UgZGF0YSB2YWx1ZXMgaW4gbG9jYWwgc2NvcGUuXG4gICAgaWYgKCFzZXR0aW5ncy52YXJpYWJsZSkgc291cmNlID0gJ3dpdGgob2JqfHx7fSl7XFxuJyArIHNvdXJjZSArICd9XFxuJztcblxuICAgIHNvdXJjZSA9IFwidmFyIF9fdCxfX3A9JycsX19qPUFycmF5LnByb3RvdHlwZS5qb2luLFwiICtcbiAgICAgIFwicHJpbnQ9ZnVuY3Rpb24oKXtfX3ArPV9fai5jYWxsKGFyZ3VtZW50cywnJyk7fTtcXG5cIiArXG4gICAgICBzb3VyY2UgKyAncmV0dXJuIF9fcDtcXG4nO1xuXG4gICAgdHJ5IHtcbiAgICAgIHZhciByZW5kZXIgPSBuZXcgRnVuY3Rpb24oc2V0dGluZ3MudmFyaWFibGUgfHwgJ29iaicsICdfJywgc291cmNlKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlLnNvdXJjZSA9IHNvdXJjZTtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgdmFyIHRlbXBsYXRlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgICAgcmV0dXJuIHJlbmRlci5jYWxsKHRoaXMsIGRhdGEsIF8pO1xuICAgIH07XG5cbiAgICAvLyBQcm92aWRlIHRoZSBjb21waWxlZCBzb3VyY2UgYXMgYSBjb252ZW5pZW5jZSBmb3IgcHJlY29tcGlsYXRpb24uXG4gICAgdmFyIGFyZ3VtZW50ID0gc2V0dGluZ3MudmFyaWFibGUgfHwgJ29iaic7XG4gICAgdGVtcGxhdGUuc291cmNlID0gJ2Z1bmN0aW9uKCcgKyBhcmd1bWVudCArICcpe1xcbicgKyBzb3VyY2UgKyAnfSc7XG5cbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH07XG5cbiAgLy8gQWRkIGEgXCJjaGFpblwiIGZ1bmN0aW9uLiBTdGFydCBjaGFpbmluZyBhIHdyYXBwZWQgVW5kZXJzY29yZSBvYmplY3QuXG4gIF8uY2hhaW4gPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgaW5zdGFuY2UgPSBfKG9iaik7XG4gICAgaW5zdGFuY2UuX2NoYWluID0gdHJ1ZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG4gIH07XG5cbiAgLy8gT09QXG4gIC8vIC0tLS0tLS0tLS0tLS0tLVxuICAvLyBJZiBVbmRlcnNjb3JlIGlzIGNhbGxlZCBhcyBhIGZ1bmN0aW9uLCBpdCByZXR1cm5zIGEgd3JhcHBlZCBvYmplY3QgdGhhdFxuICAvLyBjYW4gYmUgdXNlZCBPTy1zdHlsZS4gVGhpcyB3cmFwcGVyIGhvbGRzIGFsdGVyZWQgdmVyc2lvbnMgb2YgYWxsIHRoZVxuICAvLyB1bmRlcnNjb3JlIGZ1bmN0aW9ucy4gV3JhcHBlZCBvYmplY3RzIG1heSBiZSBjaGFpbmVkLlxuXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjb250aW51ZSBjaGFpbmluZyBpbnRlcm1lZGlhdGUgcmVzdWx0cy5cbiAgdmFyIHJlc3VsdCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiB0aGlzLl9jaGFpbiA/IF8ob2JqKS5jaGFpbigpIDogb2JqO1xuICB9O1xuXG4gIC8vIEFkZCB5b3VyIG93biBjdXN0b20gZnVuY3Rpb25zIHRvIHRoZSBVbmRlcnNjb3JlIG9iamVjdC5cbiAgXy5taXhpbiA9IGZ1bmN0aW9uKG9iaikge1xuICAgIF8uZWFjaChfLmZ1bmN0aW9ucyhvYmopLCBmdW5jdGlvbihuYW1lKSB7XG4gICAgICB2YXIgZnVuYyA9IF9bbmFtZV0gPSBvYmpbbmFtZV07XG4gICAgICBfLnByb3RvdHlwZVtuYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYXJncyA9IFt0aGlzLl93cmFwcGVkXTtcbiAgICAgICAgcHVzaC5hcHBseShhcmdzLCBhcmd1bWVudHMpO1xuICAgICAgICByZXR1cm4gcmVzdWx0LmNhbGwodGhpcywgZnVuYy5hcHBseShfLCBhcmdzKSk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEFkZCBhbGwgb2YgdGhlIFVuZGVyc2NvcmUgZnVuY3Rpb25zIHRvIHRoZSB3cmFwcGVyIG9iamVjdC5cbiAgXy5taXhpbihfKTtcblxuICAvLyBBZGQgYWxsIG11dGF0b3IgQXJyYXkgZnVuY3Rpb25zIHRvIHRoZSB3cmFwcGVyLlxuICBfLmVhY2goWydwb3AnLCAncHVzaCcsICdyZXZlcnNlJywgJ3NoaWZ0JywgJ3NvcnQnLCAnc3BsaWNlJywgJ3Vuc2hpZnQnXSwgZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBtZXRob2QgPSBBcnJheVByb3RvW25hbWVdO1xuICAgIF8ucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgb2JqID0gdGhpcy5fd3JhcHBlZDtcbiAgICAgIG1ldGhvZC5hcHBseShvYmosIGFyZ3VtZW50cyk7XG4gICAgICBpZiAoKG5hbWUgPT09ICdzaGlmdCcgfHwgbmFtZSA9PT0gJ3NwbGljZScpICYmIG9iai5sZW5ndGggPT09IDApIGRlbGV0ZSBvYmpbMF07XG4gICAgICByZXR1cm4gcmVzdWx0LmNhbGwodGhpcywgb2JqKTtcbiAgICB9O1xuICB9KTtcblxuICAvLyBBZGQgYWxsIGFjY2Vzc29yIEFycmF5IGZ1bmN0aW9ucyB0byB0aGUgd3JhcHBlci5cbiAgXy5lYWNoKFsnY29uY2F0JywgJ2pvaW4nLCAnc2xpY2UnXSwgZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBtZXRob2QgPSBBcnJheVByb3RvW25hbWVdO1xuICAgIF8ucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gcmVzdWx0LmNhbGwodGhpcywgbWV0aG9kLmFwcGx5KHRoaXMuX3dyYXBwZWQsIGFyZ3VtZW50cykpO1xuICAgIH07XG4gIH0pO1xuXG4gIC8vIEV4dHJhY3RzIHRoZSByZXN1bHQgZnJvbSBhIHdyYXBwZWQgYW5kIGNoYWluZWQgb2JqZWN0LlxuICBfLnByb3RvdHlwZS52YWx1ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl93cmFwcGVkO1xuICB9O1xuXG4gIC8vIEFNRCByZWdpc3RyYXRpb24gaGFwcGVucyBhdCB0aGUgZW5kIGZvciBjb21wYXRpYmlsaXR5IHdpdGggQU1EIGxvYWRlcnNcbiAgLy8gdGhhdCBtYXkgbm90IGVuZm9yY2UgbmV4dC10dXJuIHNlbWFudGljcyBvbiBtb2R1bGVzLiBFdmVuIHRob3VnaCBnZW5lcmFsXG4gIC8vIHByYWN0aWNlIGZvciBBTUQgcmVnaXN0cmF0aW9uIGlzIHRvIGJlIGFub255bW91cywgdW5kZXJzY29yZSByZWdpc3RlcnNcbiAgLy8gYXMgYSBuYW1lZCBtb2R1bGUgYmVjYXVzZSwgbGlrZSBqUXVlcnksIGl0IGlzIGEgYmFzZSBsaWJyYXJ5IHRoYXQgaXNcbiAgLy8gcG9wdWxhciBlbm91Z2ggdG8gYmUgYnVuZGxlZCBpbiBhIHRoaXJkIHBhcnR5IGxpYiwgYnV0IG5vdCBiZSBwYXJ0IG9mXG4gIC8vIGFuIEFNRCBsb2FkIHJlcXVlc3QuIFRob3NlIGNhc2VzIGNvdWxkIGdlbmVyYXRlIGFuIGVycm9yIHdoZW4gYW5cbiAgLy8gYW5vbnltb3VzIGRlZmluZSgpIGlzIGNhbGxlZCBvdXRzaWRlIG9mIGEgbG9hZGVyIHJlcXVlc3QuXG4gIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICBkZWZpbmUoJ3VuZGVyc2NvcmUnLCBbXSwgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gXztcbiAgICB9KTtcbiAgfVxufS5jYWxsKHRoaXMpKTtcbiIsIi8vIE5vdGUgdGhhdCBpbiBtb3JlIGNvbXBsZXggQ1NTIHJ1bGVzIGNvb3JkaW5hdGVzIGZvcm11bGEgY291bGQgYmUgZGlmZmVyZW50XG4vLyBUaGUgdmFsdWUgb2YgdGhpcyBwcm9wZXJ0eSBtdXN0IGJlIHRoZSBzYW1lIGFzIHRoZSBvbmUgc3BlY2lmaWVkIGluIHRoZSBjc3MgZmlsZVxudmFyIGNhbnZhc0JvcmRlciA9IDE7XG52YXIgY2FudmFzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJjYW52YXNcIik7XG52YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBnZXRDb29yZGluYXRlczogZnVuY3Rpb24gKGUpIHtcbiAgICB2YXIgeDtcbiAgICB2YXIgeTtcbiAgICBpZiAoZS5wYWdlWCAhPSB1bmRlZmluZWQgJiYgZS5wYWdlWSAhPSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB7XG4gIFx0ICAgIHg6IGUucGFnZVggLSBjYW52YXMub2Zmc2V0TGVmdCAtIDEsXG4gIFx0ICAgIHk6IGUucGFnZVkgLSBjYW52YXMub2Zmc2V0VG9wIC0gMVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4ge1xuICBcdCAgICB4OiBlLmNsaWVudFggKyBkb2N1bWVudC5ib2R5LnNjcm9sbExlZnQgKyBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCAtIGNhbnZhcy5vZmZzZXRMZWZ0IC0gY2FudmFzQm9yZGVyLFxuICBcdCAgICB5OiBlLmNsaWVudFkgKyBkb2N1bWVudC5ib2R5LnNjcm9sbFRvcCArIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxUb3AgLSBjYW52YXMub2Zmc2V0VG9wIC0gY2FudmFzQm9yZGVyXG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIGRyYXdUcmlhbmdsZTogZnVuY3Rpb24ocG9pbnRzLCBjb2xvcikge1xuICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICBjdHgubW92ZVRvKHBvaW50c1swXS54LCBwb2ludHNbMF0ueSk7XG4gICAgY3R4LmxpbmVUbyhwb2ludHNbMV0ueCwgcG9pbnRzWzFdLnkpO1xuICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICAgIGN0eC5zdHJva2UoKTtcbiAgICBjdHgubGluZVRvKHBvaW50c1syXS54LCBwb2ludHNbMl0ueSk7XG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgIGN0eC5maWxsKCk7XG4gIH0sXG4gIFxuICB2aXN1YWxpc2VEcmF3aW5nOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIGltZyA9IG5ldyBJbWFnZTtcbiAgICBpbWcuc3JjID0gZGF0YTtcbiAgICBpbWcub25sb2FkID0gZnVuY3Rpb24gKCkge1xuICAgICAgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpOyAgICAgIFxuICAgICAgY3R4LmRyYXdJbWFnZShpbWcsIDAsIDApXG4gICAgfSAgICBcbiAgfSxcbiAgXG4gIGNsZWFyQ2FudmFzOiBmdW5jdGlvbiAoKSB7XG4gICAgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpOyAgXG4gIH1cbn1cbiIsIi8vIExJQlNcbnZhciBfID0gcmVxdWlyZShcInVuZGVyc2NvcmVcIik7XG52YXIgY3NwID0gcmVxdWlyZShcImpzLWNzcFwiKTtcbnZhciBzdGFydCA9IGNzcC5nbztcbnZhciBzdG9yYWdlID0gcmVxdWlyZShcIi4vc3RvcmFnZVwiKTtcbnZhciBwcm9kdWNlcnMgPSByZXF1aXJlKFwiLi9wcm9kdWNlcnNcIik7XG52YXIgY3V0aWwgPSByZXF1aXJlKFwiLi9jYW52YXMtdXRpbFwiKTtcbnZhciBzZWxlY3RGaWxlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzZWxlY3RGaWxlXCIpO1xuXG4vLyBTVEFURVxudmFyIGN1cnJlbnRDb2xvciA9IFwiIzYyYTJmY1wiO1xudmFyIGZpbGVOYW1lVG9TYXZlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJmbmFtZVwiKTtcbnZhciBmaWxlTmFtZVRvT3BlbiA9IFwiXCJcblxuXG4vLyBTVEFSVCBDT05TVU1FUiBDSEFOTkVMU1xuc3RhcnQoY2FudmFzQ2xpY2tIYW5kbGVyKTtcbnN0YXJ0KHNlbGVjdE9uQ2hhbmdlSGFuZGxlcik7XG5zdGFydChyZXNldEJ1dHRvbkhhbmRsZXIpO1xuc3RhcnQoc3RvcmVCdXR0b25IYW5kbGVyKTtcbnN0YXJ0KG9wZW5CdXR0b25IYW5kbGVyKTtcbnN0YXJ0KGNvbG9yUGlja2VySGFuZGxlcik7XG5cblxuXG4vLyBJTklUSUFMSVpBVElPTlxuaW5pdFNlbGVjdEJveCgpO1xuZnVuY3Rpb24gaW5pdFNlbGVjdEJveCgpIHtcbiAgdmFyIGRyYXdpbmdOYW1lcyA9IHN0b3JhZ2UuZ2V0QWxsRHJhd2luZ05hbWVzKCk7XG4gIGlmICghXy5pc0VtcHR5KGRyYXdpbmdOYW1lcykpIHtcbiAgICB2YXIgaHRtbCA9IF8ucmVkdWNlKGRyYXdpbmdOYW1lcywgZnVuY3Rpb24gKG1lbW8sIG5hbWUsIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggPT0gMCkge1xuICAgICAgICAvL1NldHMgdGhlIGN1cnJlbnQgc2VsZWN0aW9uIHRvIHRoZSBmaXJzdCBmaWxlIGluIHRoZSBsaXN0IGFmdGVyIGVhY2ggcmVpbml0aWFsaXNhdGlvblxuICAgICAgICBmaWxlTmFtZVRvT3BlbiA9IG5hbWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gbWVtby5jb25jYXQoXCI8b3B0aW9uIHZhbHVlPVwiICsgbmFtZSArIFwiPlwiICsgbmFtZSArIFwiPC9vcHRpb24+XCIpO1xuICAgIH0sIFwiXCIpO1xuICAgIHNlbGVjdEZpbGUuaW5uZXJIVE1MID0gaHRtbDtcbiAgfSAgXG59XG5cbi8vIExPR0lDXG5mdW5jdGlvbiAqY29sb3JQaWNrZXJIYW5kbGVyKCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciBldmVudCA9IHlpZWxkIGNzcC50YWtlKHByb2R1Y2Vycy5jaGFubmVsQ29sb3JQaWNrZXIpO1xuICAgIGV2ZW50LnNyY0VsZW1lbnQgPyBjdXJyZW50Q29sb3IgPSBldmVudC5zcmNFbGVtZW50LnZhbHVlIDogY3VycmVudENvbG9yID0gZXZlbnQudGFyZ2V0LnZhbHVlXG4gIH1cbn1cblxuZnVuY3Rpb24gKm9wZW5CdXR0b25IYW5kbGVyKCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciBldmVudCA9IHlpZWxkIGNzcC50YWtlKHByb2R1Y2Vycy5jaGFubmVsT3BlbkJ1dHRvbik7XG4gICAgdmFyIGRyYXdpbmcgPSBzdG9yYWdlLmZpbmQoZmlsZU5hbWVUb09wZW4pO1xuICAgIGlmIChudWxsICE9PSBkcmF3aW5nKSB7XG4gICAgICBjdXRpbC52aXN1YWxpc2VEcmF3aW5nKGRyYXdpbmcpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiAqc3RvcmVCdXR0b25IYW5kbGVyKCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHZhciBldmVudCA9IHlpZWxkIGNzcC50YWtlKHByb2R1Y2Vycy5jaGFubmVsU3RvcmVCdXR0b24pO1xuICAgIHN0b3JhZ2Uuc2F2ZShmaWxlTmFtZVRvU2F2ZS5pbm5lckhUTUwsIGNhbnZhcy50b0RhdGFVUkwoKSk7XG4gICAgZmlsZU5hbWVUb1NhdmUuaW5uZXJIVE1MID0gXCJcIjtcbiAgICBpbml0U2VsZWN0Qm94KCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gKnJlc2V0QnV0dG9uSGFuZGxlcigpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICB2YXIgZXZlbnQgPSB5aWVsZCBjc3AudGFrZShwcm9kdWNlcnMuY2hhbm5lbFJlc2V0QnV0dG9uKTtcbiAgICBjdXRpbC5jbGVhckNhbnZhcygpO1xuICB9XG59XG5cbmZ1bmN0aW9uICpzZWxlY3RPbkNoYW5nZUhhbmRsZXIoKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdmFyIGV2ZW50ID0geWllbGQgY3NwLnRha2UocHJvZHVjZXJzLmNoYW5uZWxTZWxlY3RGaWxlKTtcbiAgICBldmVudC5zcmNFbGVtZW50ID8gZmlsZU5hbWVUb09wZW4gPSBldmVudC5zcmNFbGVtZW50LnZhbHVlIDogZmlsZU5hbWVUb09wZW4gPSBldmVudC50YXJnZXQudmFsdWU7XG4gIH1cbn1cblxuZnVuY3Rpb24gKmNhbnZhc0NsaWNrSGFuZGxlcigpIHtcbiAgdmFyIGNvdW50ZXIgPSAxO1xuICB2YXIgcG9pbnRzID0gW107XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdmFyIGV2ZW50ID0geWllbGQgY3NwLnRha2UocHJvZHVjZXJzLmNoYW5uZWxDYW52YXMpO1xuICAgIFxuICAgIGlmIChjb3VudGVyIDwgMykgeyBcbiAgICAgIHBvaW50cy5wdXNoKGN1dGlsLmdldENvb3JkaW5hdGVzKGV2ZW50KSk7IFxuICAgICAgY291bnRlcisrO1xuICAgIH0gZWxzZSB7XG4gICAgICBwb2ludHMucHVzaChjdXRpbC5nZXRDb29yZGluYXRlcyhldmVudCkpOyBcbiAgICAgIGN1dGlsLmRyYXdUcmlhbmdsZShwb2ludHMsIGN1cnJlbnRDb2xvcik7XG4gICAgICBjb3VudGVyID0gMTtcbiAgICAgIHBvaW50cyA9IFtdO1xuICAgIH1cbiAgfVxufVxuIiwiLy8gTElCU1xudmFyIGNzcCA9IHJlcXVpcmUoXCJqcy1jc3BcIik7XG5cbi8vIERPTSBFbGVtZW50c1xudmFyIGNhbnZhcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiY2FudmFzXCIpO1xudmFyIHJlc2V0QnV0dG9uID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJyZXNldFwiKTtcbnZhciBzdG9yZUJ1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwic3RvcmVcIik7XG52YXIgb3BlbkJ1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwib3BlblwiKTtcbnZhciBjb2xvclBpY2tlciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiY29sb3JQaWNrZXJcIik7XG52YXIgc2VsZWN0RmlsZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwic2VsZWN0RmlsZVwiKTtcblxuLy8gUFJPRFVDRVIgQ0hBTk5FTFNcblxuZnVuY3Rpb24gbm9PcCgpIHt9O1xuXG5mdW5jdGlvbiBjcmVhdGVDaGFubmVsKGVsZW1lbnQsIGV2ZW50TmFtZSkge1xuICB2YXIgY2ggPSBjc3AuY2hhbihjc3AuYnVmZmVycy5kcm9wcGluZygxKSk7XG4gIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgY3NwLnB1dEFzeW5jKGNoLCBldmVudCwgbm9PcCk7XG4gIH0pO1xuICByZXR1cm4gY2g7XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGNoYW5uZWxSZXNldEJ1dHRvbjogY3JlYXRlQ2hhbm5lbChyZXNldEJ1dHRvbiwgXCJjbGlja1wiKSxcbiAgY2hhbm5lbFN0b3JlQnV0dG9uOiBjcmVhdGVDaGFubmVsKHN0b3JlQnV0dG9uLCBcImNsaWNrXCIpLFxuICBjaGFubmVsT3BlbkJ1dHRvbjogY3JlYXRlQ2hhbm5lbChvcGVuQnV0dG9uLCBcImNsaWNrXCIpLFxuICBjaGFubmVsQ29sb3JQaWNrZXI6IGNyZWF0ZUNoYW5uZWwoY29sb3JQaWNrZXIsIFwiaW5wdXRcIiksXG4gIGNoYW5uZWxDYW52YXM6IGNyZWF0ZUNoYW5uZWwoY2FudmFzLCBcImNsaWNrXCIpLFxuICBjaGFubmVsU2VsZWN0RmlsZTogY3JlYXRlQ2hhbm5lbChzZWxlY3RGaWxlLCBcImNoYW5nZVwiKVxufSIsInZhciBfID0gcmVxdWlyZShcInVuZGVyc2NvcmVcIik7XG5cbmZ1bmN0aW9uIGdldERyYXdpbmdzRnJvbUxvY2FsU3RvcmFnZSgpIHtcbiAgdmFyIGN1cnJlbnREcmF3aW5ncyA9IGxvY2FsU3RvcmFnZVtcImRyYXdpbmdzXCJdO1xuICBpZiAoY3VycmVudERyYXdpbmdzID09PSB1bmRlZmluZWQgXG4gICAgfHwgY3VycmVudERyYXdpbmdzID09PSBudWxsXG4gICAgfHwgY3VycmVudERyYXdpbmdzID09PSBcIm51bGxcIlxuICAgIHx8IGN1cnJlbnREcmF3aW5ncyA9PT0gXCJcIlxuICAgIHx8ICEgY3VycmVudERyYXdpbmdzIGluc3RhbmNlb2YgQXJyYXkgKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGN1cnJlbnREcmF3aW5ncyk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmaW5kRHJhd2luZ0J5TmFtZShkcmF3aW5ncywgZHJhd2luZ05hbWUpIHtcbiAgdmFyIGRyYXdpbmcgPSBfLndoZXJlKGRyYXdpbmdzLCB7bmFtZTogZHJhd2luZ05hbWV9KTtcbiAgcmV0dXJuIGRyYXdpbmdbMF07XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBnZXRBbGxEcmF3aW5nTmFtZXM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgZHJhd2luZ3MgPSBnZXREcmF3aW5nc0Zyb21Mb2NhbFN0b3JhZ2UoKTtcbiAgICByZXR1cm4gXy5tYXAoZHJhd2luZ3MsIGZ1bmN0aW9uIChkcmF3aW5nKSB7XG4gICAgICByZXR1cm4gZHJhd2luZy5uYW1lXG4gICAgfSlcbiAgfSwgIFxuICBzYXZlOiBmdW5jdGlvbiAoZHJhd2luZ05hbWUsIGRhdGEpIHtcbiAgICB2YXIgZHJhd2luZ3MgPSBnZXREcmF3aW5nc0Zyb21Mb2NhbFN0b3JhZ2UoKTtcbiAgICB2YXIgZHJhd2luZztcbiAgXG4gICAgaWYgKGRyYXdpbmdOYW1lKSB7XG4gICAgICBkcmF3aW5nID0gZmluZERyYXdpbmdCeU5hbWUoZHJhd2luZ3MsIGRyYXdpbmdOYW1lKTtcbiAgICAgIGlmIChkcmF3aW5nKSB7XG4gICAgICAgIGFsZXJ0KCdUaGlzIG5hbWUgaXMgYWxyZWFkeSB1c2VkIScpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZHJhd2luZ3MucHVzaCh7bmFtZTogZHJhd2luZ05hbWUsIHBpYzogZGF0YX0pO1xuICAgICAgICBsb2NhbFN0b3JhZ2VbXCJkcmF3aW5nc1wiXSA9IEpTT04uc3RyaW5naWZ5KGRyYXdpbmdzKTtcbiAgICAgICAgYWxlcnQoJ0RyYXdpbmcgaXMgc2F2ZWQhJyk7ICAgICAgXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGFsZXJ0KCdTcGVjaWZ5IGZpbGUgbmFtZSEnKTtcbiAgICB9IFxuICB9LFxuICBmaW5kOiBmdW5jdGlvbiAoZHJhd2luZ05hbWUpIHtcbiAgICB2YXIgZHJhd2luZ3MgPSBnZXREcmF3aW5nc0Zyb21Mb2NhbFN0b3JhZ2UoKTtcbiAgICB2YXIgZHJhd2luZztcbiAgICBpZiAoZHJhd2luZ05hbWUpIHtcbiAgICAgIGRyYXdpbmcgPSBmaW5kRHJhd2luZ0J5TmFtZShkcmF3aW5ncywgZHJhd2luZ05hbWUpO1xuICAgICAgaWYgKCFkcmF3aW5nKSB7XG4gICAgICAgIGFsZXJ0KFwiRHJhd2luZyB3aXRoIHN1Y2ggbmFtZSBub3QgZm91bmQhXCIpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBkcmF3aW5nLnBpYztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYWxlcnQoJ1NlbGVjdCBmaWxlIHRvIG9wZW4hJyk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbn0iXX0=
