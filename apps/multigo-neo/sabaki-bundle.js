(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/@sabaki/immutable-gametree/src/Draft.js
  var require_Draft = __commonJS({
    "node_modules/@sabaki/immutable-gametree/src/Draft.js"(exports, module) {
      var Draft = class {
        constructor(base) {
          this.base = base;
          this.root = base.root;
          this._passOnNodeCache = true;
          this._nodeCache = {};
          this._idAliases = base._idAliases;
          this._heightCache = base._heightCache;
          this._structureHashCache = base._structureHashCache;
        }
        get(id) {
          if (id == null) return null;
          if (id in this._idAliases) return this.get(this._idAliases[id]);
          if (id in this._nodeCache) return this._nodeCache[id];
          let node = this.base.get(id);
          if (node == null) {
            this._nodeCache[id] = null;
            return null;
          }
          let nodeCopy = {
            ...node,
            data: { ...node.data },
            children: [...node.children]
          };
          if (node.parentId != null) {
            let parentCopy = this.get(node.parentId);
            let childIndex = parentCopy.children.findIndex((child) => child.id === id);
            if (childIndex >= 0) parentCopy.children[childIndex] = nodeCopy;
          }
          this._nodeCache[id] = nodeCopy;
          if (this.root.id === id) this.root = nodeCopy;
          return nodeCopy;
        }
        _getLevel(id) {
          let level = -1;
          let node = this.get(id);
          while (node != null) {
            level++;
            node = this.get(node.parentId);
          }
          return level;
        }
        appendNode(parentId, data, options = {}) {
          let id = this.base.getId();
          let success = this.UNSAFE_appendNodeWithId(parentId, id, data, options);
          if (!success) return null;
          let merged = id in this._idAliases;
          if (!merged) return id;
          let result = this._idAliases[id];
          delete this._idAliases[id];
          return result;
        }
        UNSAFE_appendNodeWithId(parentId, id, data, { disableMerging } = {}) {
          let parent = this.get(parentId);
          if (parent == null) return false;
          let [mergeWithId, mergedData] = (() => {
            if (!disableMerging) {
              for (let child of parent.children) {
                let mergedData2 = this.base.merger(child, data);
                if (mergedData2 != null) return [child.id, mergedData2];
              }
            }
            return [null, null];
          })();
          if (mergeWithId != null) {
            let node = this.get(mergeWithId);
            node.data = mergedData;
            if (id !== mergeWithId) {
              this._idAliases[id] = mergeWithId;
            }
          } else {
            let node = { id, data, parentId, children: [] };
            parent.children.push(node);
            this._nodeCache[id] = node;
            this._structureHashCache = null;
            if (this._heightCache != null && this._getLevel(parentId) === this._heightCache - 1) {
              this._heightCache++;
            }
          }
          return true;
        }
        removeNode(id) {
          let node = this.get(id);
          if (node == null) return false;
          let parentId = node.parentId;
          if (parentId == null) throw new Error("Cannot remove root node");
          let parent = this.get(parentId);
          if (parent == null) return false;
          let index = parent.children.findIndex((child) => child.id === id);
          if (index >= 0) parent.children.splice(index, 1);
          else return false;
          this._nodeCache[id] = null;
          this._structureHashCache = null;
          this._heightCache = null;
          return true;
        }
        shiftNode(id, direction) {
          if (!["left", "right", "main"].includes(direction)) {
            throw new Error(
              `Invalid value for direction, only 'left', 'right', or 'main' allowed`
            );
          }
          let node = this.get(id);
          if (node == null) return null;
          let { parentId } = node;
          let parent = this.get(parentId);
          if (parent == null) return null;
          let index = parent.children.findIndex((child) => child.id === id);
          if (index < 0) return null;
          let newIndex = {
            left: Math.max(index - 1, 0),
            right: Math.min(index + 1, parent.children.length),
            main: 0
          }[direction];
          if (index !== newIndex) {
            let [child] = parent.children.splice(index, 1);
            parent.children.splice(newIndex, 0, child);
          }
          this._structureHashCache = null;
          return newIndex;
        }
        makeRoot(id) {
          if (id === this.root.id) return true;
          let node = this.get(id);
          if (node == null) return false;
          node.parentId = null;
          this.root = node;
          this._passOnNodeCache = false;
          this._heightCache = null;
          this._structureHashCache = null;
          return true;
        }
        addToProperty(id, property, value) {
          let node = this.get(id);
          if (node == null) return false;
          if (node.data[property] == null) {
            node.data[property] = [value];
          } else if (!node.data[property].includes(value)) {
            node.data[property] = [...node.data[property], value];
          }
          return true;
        }
        removeFromProperty(id, property, value) {
          let node = this.get(id);
          if (node == null || node.data[property] == null) return false;
          node.data[property] = node.data[property].filter((x) => x !== value);
          if (node.data[property].length === 0) delete node.data[property];
          return true;
        }
        updateProperty(id, property, values) {
          let node = this.get(id);
          if (node == null) return false;
          if (values == null || values.length === 0) delete node.data[property];
          else node.data[property] = values;
          return true;
        }
        removeProperty(id, property) {
          return this.updateProperty(id, property, null);
        }
      };
      module.exports = Draft;
    }
  });

  // node_modules/@sabaki/immutable-gametree/src/hasher.js
  var require_hasher = __commonJS({
    "node_modules/@sabaki/immutable-gametree/src/hasher.js"(exports) {
      exports.new = function() {
        let result = 5381;
        return (str) => {
          for (let i = 0; i < str.length; i++) {
            result = result * 33 ^ str.charCodeAt(i);
          }
          return result;
        };
      };
    }
  });

  // node_modules/@sabaki/immutable-gametree/src/GameTree.js
  var require_GameTree = __commonJS({
    "node_modules/@sabaki/immutable-gametree/src/GameTree.js"(exports, module) {
      var Draft = require_Draft();
      var hasher = require_hasher();
      var GameTree3 = class _GameTree {
        constructor({ getId = null, merger = null, root = null } = {}) {
          this.getId = getId || /* @__PURE__ */ ((id = 0) => () => id++)();
          this.merger = merger || (() => null);
          root = {
            id: this.getId(),
            data: {},
            parentId: null,
            children: [],
            ...root || {}
          };
          this.root = root;
          this._nodeCache = {};
          this._idAliases = {};
          this._heightCache = null;
          this._hashCache = null;
          this._structureHashCache = null;
        }
        get(id) {
          let node = null;
          if (id == null) return node;
          if (id in this._idAliases) return this.get(this._idAliases[id]);
          if (id in this._nodeCache) {
            node = this._nodeCache[id];
          } else {
            let inner = (node2) => {
              this._nodeCache[node2.id] = node2;
              if (node2.id === id) return node2;
              for (let child of node2.children) {
                let result = inner(child);
                if (result != null) return result;
              }
              return null;
            };
            node = inner(this.root);
          }
          if (node == null) {
            this._nodeCache[id] = null;
            return null;
          }
          for (let child of node.children) {
            this._nodeCache[child.id] = child;
          }
          return node;
        }
        *getSequence(id) {
          let node = this.get(id);
          if (node == null) return;
          yield node;
          while (node.children.length === 1) {
            node = node.children[0];
            this._nodeCache[node.id] = node;
            for (let child of node.children) {
              this._nodeCache[child.id] = child;
            }
            yield node;
          }
        }
        mutate(mutator) {
          let draft = new Draft(this);
          mutator(draft);
          if (draft.root === this.root) return this;
          let tree = new _GameTree({
            getId: this.getId,
            merger: this.merger,
            root: draft.root
          });
          if (draft._passOnNodeCache) tree._nodeCache = draft._nodeCache;
          tree._idAliases = draft._idAliases;
          tree._structureHashCache = draft._structureHashCache;
          tree._heightCache = draft._heightCache;
          return tree;
        }
        navigate(id, step, currents) {
          let node = this.get(id);
          if (node == null) return null;
          if (step === 0) return node;
          if (step < 0) return this.navigate(node.parentId, step + 1);
          let nextId = currents[node.id] != null ? currents[node.id] : node.children.length > 0 ? node.children[0].id : null;
          if (nextId == null) return null;
          return this.navigate(nextId, step - 1, currents);
        }
        *listNodes() {
          function* inner(node) {
            yield node;
            for (let child of node.children) {
              yield* inner(child);
            }
          }
          yield* inner(this.root);
        }
        *listNodesHorizontally(startId, step) {
          if (Math.abs(step) !== 1)
            throw new Error("Invalid value for step, only -1 or 1 allowed");
          let level = this.getLevel(startId);
          let section = [...this.getSection(level)];
          let index = section.findIndex((node) => node.id === startId);
          while (section[index] != null) {
            while (0 <= index && index < section.length) {
              yield section[index];
              index += step;
            }
            level += step;
            section = step > 0 ? [].concat(...section.map((node) => node.children)) : [...this.getSection(level)];
            index = step > 0 ? 0 : section.length - 1;
          }
        }
        *listNodesVertically(startId, step, currents) {
          if (Math.abs(step) !== 1)
            throw new Error("Invalid value for step, only -1 or 1 allowed");
          let id = startId;
          let node = this.get(id);
          while (node != null) {
            yield node;
            node = this.navigate(node.id, step, currents);
          }
        }
        *listCurrentNodes(currents) {
          yield* this.listNodesVertically(this.root.id, 1, currents);
        }
        *listMainNodes() {
          yield* this.listCurrentNodes({});
        }
        getLevel(id) {
          let result = -1;
          for (let node of this.listNodesVertically(id, -1, {})) {
            result++;
          }
          return result < 0 ? null : result;
        }
        *getSection(level) {
          if (level < 0) return;
          if (level === 0) {
            yield this.root;
            return;
          }
          for (let parent of this.getSection(level - 1)) {
            yield* parent.children;
          }
        }
        getCurrentHeight(currents) {
          let result = 0;
          let node = this.root;
          while (node != null) {
            result++;
            node = currents[node.id] == null ? node.children[0] : node.children.find((child) => child.id === currents[node.id]);
          }
          return result;
        }
        getHeight() {
          if (this._heightCache == null) {
            let inner = (node) => {
              let max = 0;
              for (let child of node.children) {
                max = Math.max(max, inner(child));
              }
              return max + 1;
            };
            this._heightCache = inner(this.root);
          }
          return this._heightCache;
        }
        getStructureHash() {
          if (this._structureHashCache == null) {
            let hash = hasher.new();
            let inner = (node) => {
              hash("[" + JSON.stringify(node.id) + ",");
              node.children.forEach(inner);
              return hash("]");
            };
            this._structureHashCache = inner(this.root);
          }
          return (this._structureHashCache >>> 0) + "";
        }
        getHash() {
          if (this._hashCache == null) {
            let hash = hasher.new();
            let inner = (node) => {
              hash("[" + JSON.stringify(node.data) + ",");
              node.children.forEach(inner);
              return hash("]");
            };
            this._hashCache = inner(this.root);
          }
          return (this._hashCache >>> 0) + "";
        }
        onCurrentLine(id, currents) {
          for (let node of this.listNodesVertically(id, -1, {})) {
            let { parentId } = node;
            if (parentId != null && currents[parentId] !== node.id && (currents[parentId] != null || this.get(parentId).children[0] !== node))
              return false;
          }
          return true;
        }
        onMainLine(id) {
          return this.onCurrentLine(id, {});
        }
        toJSON() {
          return this.root;
        }
      };
      module.exports = GameTree3;
    }
  });

  // node_modules/@sabaki/immutable-gametree/src/main.js
  var require_main = __commonJS({
    "node_modules/@sabaki/immutable-gametree/src/main.js"(exports, module) {
      module.exports = require_GameTree();
    }
  });

  // node_modules/@sabaki/go-board/src/GoBoard.js
  var require_GoBoard = __commonJS({
    "node_modules/@sabaki/go-board/src/GoBoard.js"(exports, module) {
      var alpha2 = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
      function vertexEquals2([x1, y1], [x2, y2]) {
        return x1 === x2 && y1 === y2;
      }
      var GoBoard = class _GoBoard {
        constructor(signMap = []) {
          this.signMap = signMap;
          this.height = signMap.length;
          this.width = this.height === 0 ? 0 : signMap[0].length;
          if (signMap.some((row) => row.length !== this.width)) {
            throw new Error("signMap is not well-formed");
          }
          this._players = [1, -1];
          this._captures = [0, 0];
          this._koInfo = { sign: 0, vertex: [-1, -1] };
        }
        get([x, y]) {
          return this.signMap[y] != null ? this.signMap[y][x] : null;
        }
        set([x, y], sign) {
          if (this.has([x, y])) {
            this.signMap[y][x] = sign;
          }
          return this;
        }
        has([x, y]) {
          return 0 <= x && x < this.width && 0 <= y && y < this.height;
        }
        clear() {
          this.signMap = this.signMap.map((row) => row.map((_) => 0));
          return this;
        }
        makeMove(sign, vertex, {
          preventSuicide = false,
          preventOverwrite = false,
          preventKo = false
        } = {}) {
          let move = this.clone();
          if (sign === 0 || !this.has(vertex)) return move;
          if (preventOverwrite && !!this.get(vertex)) {
            throw new Error("Overwrite prevented");
          }
          sign = sign > 0 ? 1 : -1;
          if (preventKo && this._koInfo.sign === sign && vertexEquals2(this._koInfo.vertex, vertex)) {
            throw new Error("Ko prevented");
          }
          move.set(vertex, sign);
          let neighbors = move.getNeighbors(vertex);
          let deadStones = [];
          let deadNeighbors = neighbors.filter((n) => move.get(n) === -sign && !move.hasLiberties(n));
          for (let n of deadNeighbors) {
            if (move.get(n) === 0) continue;
            for (let c of move.getChain(n)) {
              move.set(c, 0).setCaptures(sign, (x) => x + 1);
              deadStones.push(c);
            }
          }
          let liberties = move.getLiberties(vertex);
          let hasKo = deadStones.length === 1 && liberties.length === 1 && vertexEquals2(liberties[0], deadStones[0]) && neighbors.every((n) => move.get(n) !== sign);
          move._koInfo = {
            sign: hasKo ? -sign : 0,
            vertex: hasKo ? deadStones[0] : [-1, -1]
          };
          if (deadStones.length === 0 && liberties.length === 0) {
            if (preventSuicide) {
              throw new Error("Suicide prevented");
            }
            for (let c of move.getChain(vertex)) {
              move.set(c, 0).setCaptures(-sign, (x) => x + 1);
            }
          }
          return move;
        }
        analyzeMove(sign, vertex) {
          let pass = sign === 0 || !this.has(vertex);
          let overwrite = !pass && !!this.get(vertex);
          let ko = this._koInfo.sign === sign && vertexEquals2(this._koInfo.vertex, vertex);
          let originalSign = this.get(vertex);
          this.set(vertex, sign);
          let capturing = !pass && this.getNeighbors(vertex).some((n) => this.get(n) === -sign && !this.hasLiberties(n));
          let suicide = !pass && !capturing && !this.hasLiberties(vertex);
          this.set(vertex, originalSign);
          return { pass, overwrite, capturing, suicide, ko };
        }
        getCaptures(sign) {
          let index = this._players.indexOf(sign);
          if (index < 0) return null;
          return this._captures[index];
        }
        setCaptures(sign, mutator) {
          let index = this._players.indexOf(sign);
          if (index >= 0) {
            this._captures[index] = typeof mutator === "function" ? mutator(this._captures[index]) : mutator;
          }
          return this;
        }
        isSquare() {
          return this.width === this.height;
        }
        isEmpty() {
          return this.signMap.every((row) => row.every((x) => !x));
        }
        isValid() {
          let liberties = {};
          for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
              let vertex = [x, y];
              if (this.get(vertex) === 0 || vertex in liberties) continue;
              if (!this.hasLiberties(vertex)) return false;
              this.getChain(vertex).forEach((v) => liberties[v] = true);
            }
          }
          return true;
        }
        getDistance([x1, y1], [x2, y2]) {
          return Math.abs(x2 - x1) + Math.abs(y2 - y1);
        }
        getNeighbors(vertex) {
          if (!this.has(vertex)) return [];
          let [x, y] = vertex;
          return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter((v) => this.has(v));
        }
        getConnectedComponent(vertex, predicate, result = null) {
          if (!this.has(vertex)) return [];
          if (!result) result = [vertex];
          for (let v of this.getNeighbors(vertex)) {
            if (!predicate(v)) continue;
            if (result.some((w) => vertexEquals2(w, v))) continue;
            result.push(v);
            this.getConnectedComponent(v, predicate, result);
          }
          return result;
        }
        getChain(vertex) {
          let sign = this.get(vertex);
          return this.getConnectedComponent(vertex, (v) => this.get(v) === sign);
        }
        getRelatedChains(vertex) {
          if (!this.has(vertex) || this.get(vertex) === 0) return [];
          let signs = [this.get(vertex), 0];
          let area = this.getConnectedComponent(vertex, (v) => signs.includes(this.get(v)));
          return area.filter((v) => this.get(v) === this.get(vertex));
        }
        getLiberties(vertex) {
          if (!this.has(vertex) || this.get(vertex) === 0) return [];
          let chain = this.getChain(vertex);
          let liberties = [];
          let added = {};
          for (let c of chain) {
            let freeNeighbors = this.getNeighbors(c).filter((n) => this.get(n) === 0);
            liberties.push(...freeNeighbors.filter((n) => !(n in added)));
            freeNeighbors.forEach((n) => added[n] = true);
          }
          return liberties;
        }
        hasLiberties(vertex, visited = {}) {
          let sign = this.get(vertex);
          if (!this.has(vertex) || sign === 0) return false;
          if (vertex in visited) return false;
          let neighbors = this.getNeighbors(vertex);
          if (neighbors.some((n) => this.get(n) === 0))
            return true;
          visited[vertex] = true;
          return neighbors.filter((n) => this.get(n) === sign).some((n) => this.hasLiberties(n, visited));
        }
        clone() {
          let result = new _GoBoard(this.signMap.map((row) => [...row])).setCaptures(1, this.getCaptures(1)).setCaptures(-1, this.getCaptures(-1));
          result._koInfo = this._koInfo;
          return result;
        }
        diff(board) {
          if (board.width !== this.width || board.height !== this.height) {
            return null;
          }
          let result = [];
          for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
              let sign = board.get([x, y]);
              if (this.get([x, y]) === sign) continue;
              result.push([x, y]);
            }
          }
          return result;
        }
        stringifyVertex(vertex) {
          if (!this.has(vertex)) return "";
          return alpha2[vertex[0]] + (this.height - vertex[1]);
        }
        parseVertex(coord) {
          if (coord.length < 2) return [-1, -1];
          let x = alpha2.indexOf(coord[0].toUpperCase());
          let y = this.height - +coord.slice(1);
          let v = [x, y];
          return this.has(v) ? v : [-1, -1];
        }
        getHandicapPlacement(count, { tygem = false } = {}) {
          if (Math.min(this.width, this.height) <= 6 || count < 2) return [];
          let [nearX, nearY] = [this.width, this.height].map((x) => x >= 13 ? 3 : 2);
          let [farX, farY] = [this.width - nearX - 1, this.height - nearY - 1];
          let [middleX, middleY] = [this.width, this.height].map((x) => (x - 1) / 2);
          let result = !tygem ? [[nearX, farY], [farX, nearY], [farX, farY], [nearX, nearY]] : [[nearX, farY], [farX, nearY], [nearX, nearY], [farX, farY]];
          if (this.width % 2 !== 0 && this.height % 2 !== 0 && this.width !== 7 && this.height !== 7) {
            if (count === 5) result.push([middleX, middleY]);
            result.push([nearX, middleY], [farX, middleY]);
            if (count === 7) result.push([middleX, middleY]);
            result.push([middleX, nearY], [middleX, farY], [middleX, middleY]);
          } else if (this.width % 2 !== 0 && this.width !== 7) {
            result.push([middleX, nearY], [middleX, farY]);
          } else if (this.height % 2 !== 0 && this.height !== 7) {
            result.push([nearX, middleY], [farX, middleY]);
          }
          return result.slice(0, count);
        }
      };
      GoBoard.fromDimensions = (width, height = null) => {
        if (height == null) height = width;
        let signMap = [...Array(height)].map((_) => Array(width).fill(0));
        return new GoBoard(signMap);
      };
      module.exports = GoBoard;
    }
  });

  // node_modules/@sabaki/go-board/src/main.js
  var require_main2 = __commonJS({
    "node_modules/@sabaki/go-board/src/main.js"(exports, module) {
      var GoBoard = require_GoBoard();
      module.exports = GoBoard;
    }
  });

  // node_modules/doken/src/main.js
  var require_main3 = __commonJS({
    "node_modules/doken/src/main.js"(exports) {
      exports.regexRule = function(type, regex, {
        lineBreaks = false,
        stateCondition = (state) => true,
        value = (match, state) => match[0],
        last = (match, state) => false,
        condition = (match, state) => true,
        nextState = (match, state) => state
      } = {}) {
        if (!regex.sticky && !regex.global) {
          throw new TypeError(
            "Either sticky (/y, recommended) or global (/g) has to be enabled for the regular expresion."
          );
        }
        return {
          type,
          lineBreaks,
          match(input, position, state) {
            if (!stateCondition(state)) return null;
            regex.lastIndex = position;
            let match = regex.exec(input);
            if (match == null || match.index !== position || !condition(match, state)) {
              return null;
            }
            return {
              length: match[0].length,
              value: value(match, state),
              last: last(match, state),
              state: nextState(match, state)
            };
          }
        };
      };
      exports.tokenizerRule = function(type, tokenize, {
        lineBreaks = false,
        stateCondition = (state) => true,
        value = (tokens, state) => tokens,
        last = (tokens, state) => false,
        condition = (tokens, state) => true,
        nextState = (tokens, state) => state
      } = {}) {
        return {
          type,
          lineBreaks,
          match(input, position, state) {
            if (!stateCondition(state)) return null;
            let tokensIter = tokenize(input);
            tokensIter.col = this.col;
            tokensIter.row = this.row;
            tokensIter.pos = position;
            let tokens = [...tokensIter];
            if (!condition(tokens, state)) return null;
            return {
              length: tokensIter.pos - position,
              value: value(tokens, state),
              last: last(tokens, state),
              state: nextState(tokens, state)
            };
          }
        };
      };
      exports.createTokenizer = function({ rules, strategy = "first", state = {} }) {
        if (!["first", "longest"].includes(strategy)) {
          throw new TypeError(
            "Only 'first' and 'longest' are allowed as values for the strategy option."
          );
        }
        return function tokenize(input) {
          return {
            state,
            row: 0,
            col: 0,
            pos: 0,
            done: false,
            [Symbol.iterator]() {
              return this;
            },
            next() {
              while (!this.done && this.pos < input.length) {
                let token, tokenText, match;
                let lineBreaks = false;
                for (let rule of rules) {
                  match = rule.match.call(this, input, this.pos, this.state);
                  if (match == null) continue;
                  let value = match.value;
                  if (value === void 0) {
                    value = tokenText = input.substr(this.pos, match.length);
                  }
                  if (token == null || token.length < match.length) {
                    token = {
                      type: rule.type,
                      value,
                      row: this.row,
                      col: this.col,
                      pos: this.pos,
                      length: match.length
                    };
                    lineBreaks = !!rule.lineBreaks;
                  }
                  if (strategy === "first") break;
                }
                if (token == null) {
                  token = {
                    type: null,
                    value: input[this.pos],
                    row: this.row,
                    col: this.col,
                    pos: this.pos,
                    length: 1
                  };
                  lineBreaks = true;
                }
                let newLineCount = 0;
                let lastNewLineIndex = -1;
                if (lineBreaks) {
                  if (tokenText == null) {
                    tokenText = input.substr(this.pos, token.length);
                  }
                  newLineCount = Array.from(tokenText).filter((c, i) => {
                    if (c === "\n") {
                      lastNewLineIndex = i;
                      return true;
                    }
                    return false;
                  }).length;
                  this.row += newLineCount;
                }
                if (newLineCount > 0) {
                  this.col = token.length - lastNewLineIndex - 1;
                } else {
                  this.col += token.length;
                }
                this.pos += token.length;
                if (match != null && match.state != null) {
                  this.state = match.state;
                  this.done = !!match.last;
                }
                if (token.type == null || token.type[0] !== "_") {
                  return { value: token, done: false };
                }
              }
              this.done = true;
              return { done: true };
            }
          };
        };
      };
    }
  });

  // src/browser-shim.cjs
  var require_browser_shim = __commonJS({
    "src/browser-shim.cjs"(exports, module) {
      module.exports = {
        encodingExists: () => true,
        decode: (buffer) => buffer.toString(),
        encode: (value) => value,
        detect: () => ({ encoding: "UTF-8" })
      };
    }
  });

  // node_modules/@sabaki/sgf/src/iconv-lite.js
  var require_iconv_lite = __commonJS({
    "node_modules/@sabaki/sgf/src/iconv-lite.js"(exports, module) {
      module.exports = (() => {
        try {
          let m = require_browser_shim();
          if (m == null) throw new Error();
          return m;
        } catch (err) {
          return {
            encodingExists: () => true,
            decode: (buffer) => buffer.toString(),
            encode: (str, _) => str
          };
        }
      })();
    }
  });

  // node_modules/@sabaki/sgf/src/jschardet.js
  var require_jschardet = __commonJS({
    "node_modules/@sabaki/sgf/src/jschardet.js"(exports, module) {
      module.exports = (() => {
        try {
          let m = require_browser_shim();
          if (m == null) throw new Error();
          return m;
        } catch (err) {
          return {
            detect: () => ({ encoding: "UTF-8" })
          };
        }
      })();
    }
  });

  // node_modules/@sabaki/sgf/src/helper.js
  var require_helper = __commonJS({
    "node_modules/@sabaki/sgf/src/helper.js"(exports) {
      var alpha2 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      exports.escapeString = function(input) {
        return input.toString().replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
      };
      exports.unescapeString = function(input) {
        let result = [];
        let inBackslash = false;
        input = input.replace(/\r/g, "");
        for (let i = 0; i < input.length; i++) {
          if (!inBackslash) {
            if (input[i] !== "\\") result.push(input[i]);
            else if (input[i] === "\\") inBackslash = true;
          } else {
            if (input[i] !== "\n") result.push(input[i]);
            inBackslash = false;
          }
        }
        return result.join("");
      };
      exports.parseDates = function(input) {
        if (!input.match(
          /^(\d{4}(-\d{1,2}(-\d{1,2})?)?(\s*,\s*(\d{4}|(\d{4}-)?\d{1,2}(-\d{1,2})?))*)?$/
        ))
          return null;
        if (input.trim() === "") return [];
        let dates = input.split(",").map((x) => x.trim().split("-"));
        for (let i = 1; i < dates.length; i++) {
          let date = dates[i];
          let prev = dates[i - 1];
          if (date[0].length !== 4) {
            if (date.length === 1 && prev.length === 3) {
              date.unshift(prev[1]);
            }
            date.unshift(prev[0]);
          }
        }
        return dates.map((x) => x.map((y) => +y));
      };
      exports.stringifyDates = function(dates) {
        if (dates.length === 0) return "";
        let datesCopy = [dates[0].slice()];
        for (let i = 1; i < dates.length; i++) {
          let date = dates[i];
          let prev = dates[i - 1];
          let k = 0;
          for (let j = 0; j < date.length; j++) {
            if (date[j] === prev[j] && k === j) k++;
            else break;
          }
          datesCopy.push(date.slice(k));
        }
        return datesCopy.map((x) => x.map((y) => y > 9 ? "" + y : "0" + y).join("-")).join(",");
      };
      exports.parseVertex = function(input) {
        if (input.length !== 2) return [-1, -1];
        return input.split("").map((x) => alpha2.indexOf(x));
      };
      exports.stringifyVertex = function([x, y]) {
        if (Math.min(x, y) < 0 || Math.max(x, y) >= alpha2.length) return "";
        return alpha2[x] + alpha2[y];
      };
      exports.parseCompressedVertices = function(input) {
        let colon = input.indexOf(":");
        if (colon < 0) return [exports.parseVertex(input)];
        let [x1, y1] = exports.parseVertex(input.slice(0, colon));
        let [x2, y2] = exports.parseVertex(input.slice(colon + 1));
        let vertices = [];
        for (let i = Math.min(x1, x2); i <= Math.max(x1, x2); i++) {
          for (let j = Math.min(y1, y2); j <= Math.max(y1, y2); j++) {
            vertices.push([i, j]);
          }
        }
        return vertices;
      };
    }
  });

  // node_modules/@sabaki/sgf/src/tokenize.js
  var require_tokenize = __commonJS({
    "node_modules/@sabaki/sgf/src/tokenize.js"(exports) {
      var { createTokenizer, regexRule } = require_main3();
      var iconv = require_iconv_lite();
      var jschardet = require_jschardet();
      var { unescapeString } = require_helper();
      var recoveryCandidates = [
        "shift_jis",
        "gb18030",
        "big5",
        "euc-jp",
        "euc-kr",
        "windows-1251",
        "koi8-r"
      ];
      var jschardetConfidenceThreshold = 0.85;
      var _tokenize = createTokenizer({
        rules: [
          regexRule("_whitespace", /\s+/y, { lineBreaks: true }),
          regexRule("parenthesis", /(\(|\))/y),
          regexRule("semicolon", /;/y),
          regexRule("prop_ident", /[A-Za-z]+/y),
          regexRule("c_value_type", /\[([^\\\]]|\\[^])*\]/y, { lineBreaks: true }),
          {
            type: "invalid",
            match: (input, position) => ({ length: 1 })
          }
        ]
      });
      exports.tokenizeIter = function* (contents) {
        for (let token of _tokenize(contents)) {
          token.progress = token.pos / (contents.length - 1);
          delete token.length;
          yield token;
        }
      };
      function findCharsetProperty(buffer) {
        let contents = iconv.decode(buffer, "latin1");
        let lastToken = null;
        for (let token of exports.tokenizeIter(contents)) {
          if (token.type === "c_value_type" && lastToken != null && lastToken.type === "prop_ident" && lastToken.value === "CA") {
            return unescapeString(token.value.slice(1, -1));
          }
          lastToken = token;
        }
        return null;
      }
      function isValidUtf8(buffer) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          return true;
        } catch (err) {
          return false;
        }
      }
      function classify(codePoint) {
        let c = codePoint;
        if (c === 65533) return "repl";
        if (c >= 12352 && c <= 12543) return "kana";
        if (c >= 44032 && c <= 55203) return "hangul";
        if (c >= 13312 && c <= 40959) return "han";
        if (c >= 1024 && c <= 1279) return "cyrillic";
        if (c >= 192 && c <= 591) return "latin";
        if (c >= 12288 && c <= 12351 || c >= 65280 && c <= 65519)
          return "punct";
        return "junk";
      }
      function scoreDecoding(str) {
        let counts = {
          kana: 0,
          hangul: 0,
          han: 0,
          cyrillic: 0,
          latin: 0,
          punct: 0,
          junk: 0,
          repl: 0
        };
        let high = 0;
        for (let ch of str) {
          let c = ch.codePointAt(0);
          if (c < 128) continue;
          high++;
          counts[classify(c)]++;
        }
        if (high === 0) return -1;
        let meaningful = counts.kana + counts.hangul + counts.han + counts.cyrillic + counts.latin;
        let noise = 2 * counts.repl + counts.junk + 0.6 * counts.punct;
        let score = (meaningful - noise) / high;
        if (counts.kana > 0) score += 0.5;
        if (counts.hangul > 0 && counts.han === 0) score += 0.4;
        return score;
      }
      function meaningfulBytes(buffer) {
        let contents = iconv.decode(buffer, "latin1");
        let result = "";
        for (let match of contents.matchAll(/[A-Za-z]+\[((?:[^\\\]]|\\[^])*)\]/g)) {
          let value = match[1];
          if ([...value].some((c) => c.charCodeAt(0) >= 128)) result += value;
        }
        return iconv.encode(result, "latin1");
      }
      function recoverEncoding(buffer) {
        let sample = meaningfulBytes(buffer);
        if (sample.length === 0) return null;
        let best = null;
        for (let encoding of recoveryCandidates) {
          if (!iconv.encodingExists(encoding)) continue;
          let score = scoreDecoding(iconv.decode(sample, encoding));
          if (best == null || score > best.score) best = { encoding, score };
        }
        return best != null && best.score > 0 ? best.encoding : null;
      }
      function detectEncoding(buffer) {
        let charset = findCharsetProperty(buffer);
        if (charset != null && iconv.encodingExists(charset)) return charset;
        if (isValidUtf8(buffer)) return "utf8";
        let detected = jschardet.detect(buffer);
        if (detected.encoding != null && detected.confidence >= jschardetConfidenceThreshold && iconv.encodingExists(detected.encoding)) {
          return detected.encoding;
        }
        let recovered = recoverEncoding(buffer);
        if (recovered != null) return recovered;
        return "latin1";
      }
      exports.tokenizeBufferIter = function* (buffer, { encoding = null } = {}) {
        if (encoding == null) encoding = detectEncoding(buffer);
        yield* exports.tokenizeIter(iconv.decode(buffer, encoding));
      };
      exports.tokenize = (contents) => [...exports.tokenizeIter(contents)];
      exports.tokenizeBuffer = (buffer, opts) => [
        ...exports.tokenizeBufferIter(buffer, opts)
      ];
    }
  });

  // node_modules/@sabaki/sgf/src/peekable.js
  var require_peekable = __commonJS({
    "node_modules/@sabaki/sgf/src/peekable.js"(exports, module) {
      var Peekable = class {
        constructor(iterator) {
          this.iterator = iterator[Symbol.iterator]();
          this.peekedItem = null;
          this.peeked = false;
        }
        next() {
          let next = this.peeked ? this.peekedItem : this.iterator.next();
          this.peekedItem = null;
          this.peeked = false;
          return next;
        }
        peek() {
          if (!this.peeked) {
            this.peekedItem = this.iterator.next();
            this.peeked = true;
          }
          return this.peekedItem;
        }
      };
      module.exports = Peekable;
    }
  });

  // node_modules/@sabaki/sgf/src/parse.js
  var require_parse = __commonJS({
    "node_modules/@sabaki/sgf/src/parse.js"(exports) {
      var fs = require_browser_shim();
      var Peekable = require_peekable();
      var { tokenizeIter, tokenizeBufferIter } = require_tokenize();
      var { unescapeString } = require_helper();
      function _parseTokens(peekableTokens, parentId, options) {
        let { getId, dictionary, onProgress, onNodeCreated } = options;
        let anchor = null;
        let node, property;
        while (!peekableTokens.peek().done) {
          let { type, value, row, col } = peekableTokens.peek().value;
          if (type === "parenthesis" && value === "(") break;
          if (type === "parenthesis" && value === ")") {
            if (node != null) onNodeCreated({ node });
            return anchor;
          }
          if (type === "semicolon" || node == null) {
            let lastNode = node;
            node = {
              id: getId(),
              data: {},
              parentId: lastNode == null ? parentId : lastNode.id,
              children: []
            };
            if (dictionary != null) dictionary[node.id] = node;
            if (lastNode != null) {
              onNodeCreated({ node: lastNode });
              lastNode.children.push(node);
            } else {
              anchor = node;
            }
          }
          if (type === "semicolon") {
          } else if (type === "prop_ident") {
            if (node != null) {
              let identifier = value === value.toUpperCase() ? value : value.split("").filter((x) => x.toUpperCase() === x).join("");
              if (identifier !== "") {
                if (!(identifier in node.data)) node.data[identifier] = [];
                property = node.data[identifier];
              } else {
                property = null;
              }
            }
          } else if (type === "c_value_type") {
            if (property != null) {
              property.push(unescapeString(value.slice(1, -1)));
            }
          } else if (type === "invalid") {
            throw new Error(`Unexpected token at ${row + 1}:${col + 1}`);
          } else {
            throw new Error(
              `Unexpected token type '${type}' at ${row + 1}:${col + 1}`
            );
          }
          peekableTokens.next();
        }
        if (node == null) {
          anchor = node = {
            id: null,
            data: {},
            parentId: null,
            children: []
          };
        } else {
          onNodeCreated({ node });
        }
        while (!peekableTokens.peek().done) {
          let { type, value, progress } = peekableTokens.peek().value;
          if (type === "parenthesis" && value === "(") {
            peekableTokens.next();
            let child = _parseTokens(peekableTokens, node.id, options);
            if (child != null) {
              node.children.push(child);
            }
          } else if (type === "parenthesis" && value === ")") {
            onProgress({ progress });
            break;
          }
          peekableTokens.next();
        }
        return anchor;
      }
      exports.parseTokens = function(tokens, {
        getId = /* @__PURE__ */ ((id) => () => id++)(0),
        dictionary = null,
        onProgress = () => {
        },
        onNodeCreated = () => {
        }
      } = {}) {
        let node = _parseTokens(new Peekable(tokens), null, {
          getId,
          dictionary,
          onProgress,
          onNodeCreated
        });
        return node.id == null ? node.children : [node];
      };
      exports.parse = function(contents, options = {}) {
        return exports.parseTokens(tokenizeIter(contents), options);
      };
      exports.parseBuffer = function(buffer, options = {}) {
        return exports.parseTokens(
          tokenizeBufferIter(buffer, { encoding: options.encoding }),
          options
        );
      };
      exports.parseFile = function(filename, options = {}) {
        return exports.parseBuffer(fs.readFileSync(filename), options);
      };
    }
  });

  // node_modules/@sabaki/sgf/src/stringify.js
  var require_stringify = __commonJS({
    "node_modules/@sabaki/sgf/src/stringify.js"(exports) {
      var { escapeString } = require_helper();
      exports.stringify = function(node, { linebreak = "\n", indent = "  ", level = 0 } = {}) {
        if (Array.isArray(node)) {
          return exports.stringify({ children: node }, { linebreak, level });
        }
        let output = [];
        let totalIndent = linebreak !== "" ? indent.repeat(level) : "";
        if (node.data != null) {
          output.push(totalIndent, ";");
          for (let id in node.data) {
            if (id.toUpperCase() !== id) continue;
            output.push(id, "[", node.data[id].map(escapeString).join("]["), "]");
          }
          output.push(linebreak);
        }
        if (node.children.length > 1 || node.children.length > 0 && level === 0) {
          output.push(totalIndent);
          for (let child of node.children) {
            output.push(
              "(",
              linebreak,
              exports.stringify(child, { linebreak, level: level + 1 }),
              totalIndent,
              ")"
            );
          }
          output.push(linebreak);
        } else if (node.children.length === 1) {
          output.push(exports.stringify(node.children[0], { linebreak, level }));
        }
        return output.join("");
      };
    }
  });

  // node_modules/@sabaki/sgf/src/main.js
  var require_main4 = __commonJS({
    "node_modules/@sabaki/sgf/src/main.js"(exports) {
      var {
        tokenizeIter,
        tokenizeBufferIter,
        tokenize,
        tokenizeBuffer
      } = require_tokenize();
      var { parse, parseTokens, parseBuffer, parseFile } = require_parse();
      var { stringify } = require_stringify();
      var helper = require_helper();
      Object.assign(
        exports,
        {
          tokenizeIter,
          tokenizeBufferIter,
          tokenize,
          tokenizeBuffer,
          parse,
          parseTokens,
          parseBuffer,
          parseFile,
          stringify
        },
        helper
      );
    }
  });

  // src/sabaki-entry.js
  var import_immutable_gametree2 = __toESM(require_main());
  var import_go_board2 = __toESM(require_main2());
  var sgf = __toESM(require_main4());

  // src/vendor/gametree.js
  var gametree_exports = {};
  __export(gametree_exports, {
    GameTree: () => import_immutable_gametree.default,
    clearBoardCache: () => clearBoardCache,
    getBoard: () => getBoard,
    getGameInfo: () => getGameInfo,
    getMatrixDict: () => getMatrixDict,
    getMatrixWidth: () => getMatrixWidth,
    getMoveNumber: () => getMoveNumber,
    getPath: () => getPath,
    getPlayer: () => getPlayer,
    getRootProperty: () => getRootProperty,
    nodeMerger: () => nodeMerger,
    setGameInfo: () => setGameInfo
  });
  var import_go_board = __toESM(require_main2());
  var import_immutable_gametree = __toESM(require_main());
  var import_sgf2 = __toESM(require_main4());

  // src/vendor/linecolor.js
  var linecolor_exports = {};
  __export(linecolor_exports, {
    LINE_COLORS: () => LINE_COLORS,
    formatLineValue: () => formatLineValue,
    normalizeLineColor: () => normalizeLineColor,
    parseLineValue: () => parseLineValue
  });
  var LINE_COLORS = ["black", "white", "red", "yellow", "blue", "green"];
  function normalizeLineColor(value) {
    if (typeof value !== "string") return null;
    const color = value.trim().toLowerCase();
    return LINE_COLORS.includes(color) ? color : null;
  }
  function parseLineValue(value) {
    const parts = String(value).split(":");
    return {
      points: [parts[0], parts[1]],
      color: normalizeLineColor(parts[2])
    };
  }
  function formatLineValue(p1, p2, color) {
    const normalized = normalizeLineColor(color);
    return normalized == null ? `${p1}:${p2}` : `${p1}:${p2}:${normalized}`;
  }

  // src/vendor/dim.js
  var dim_exports = {};
  __export(dim_exports, {
    DIM_PAINT_DEFAULT: () => DIM_PAINT_DEFAULT,
    applyDimRectangle: () => applyDimRectangle,
    dimPaintColorName: () => dimPaintColorName,
    dimPaintValue: () => dimPaintValue,
    findDimRangeAt: () => findDimRangeAt,
    normalizeDimValue: () => normalizeDimValue,
    parseDimColors: () => parseDimColors,
    toDimEntries: () => toDimEntries,
    toDimRange: () => toDimRange
  });
  var import_sgf = __toESM(require_main4());
  var DIM_PAINT_DEFAULT = 1;
  function toDimRange(v1, v2) {
    const [p1, p2] = [v1, v2].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return [p1, p2].map(import_sgf.stringifyVertex).join(":");
  }
  function normalizeDimValue(value) {
    if (value == null || value === "") return "";
    const [p1, p2] = String(value).split(":");
    if (p2 == null) return (0, import_sgf.stringifyVertex)((0, import_sgf.parseVertex)(p1));
    return toDimRange((0, import_sgf.parseVertex)(p1), (0, import_sgf.parseVertex)(p2));
  }
  function parseDimColors(values = [], ranges = []) {
    const known = new Set(ranges);
    const colors = {};
    for (const value of values) {
      const [color, ...rest] = String(value).split(":");
      const normalized = normalizeLineColor(color);
      const range = normalizeDimValue(rest.join(":"));
      if (normalized == null || !known.has(range)) continue;
      colors[range] = normalized;
    }
    return colors;
  }
  var vertexEquals = (a, b) => a[0] === b[0] && a[1] === b[1];
  function toDimEntries(ranges, colors = {}) {
    const byVertex = /* @__PURE__ */ new Map();
    for (const range of ranges) {
      if (!range) continue;
      for (const vertex of (0, import_sgf.parseCompressedVertices)(range)) {
        byVertex.set(vertex.join(","), {
          vertex,
          color: colors[range] ?? null
        });
      }
    }
    return [...byVertex.values()];
  }
  function findDimRangeAt(ranges, vertex) {
    for (let i = ranges.length - 1; i >= 0; i--) {
      if ((0, import_sgf.parseCompressedVertices)(ranges[i]).some((v) => vertexEquals(v, vertex))) {
        return i;
      }
    }
    return -1;
  }
  function applyDimRectangle(ranges, colors, range, color) {
    let nextRanges = [...ranges];
    const nextColors = { ...colors };
    const exists = nextRanges.includes(range);
    if (exists && (nextColors[range] ?? null) === color) {
      nextRanges = nextRanges.filter((x) => x !== range);
      delete nextColors[range];
    } else if (exists) {
      if (color == null) delete nextColors[range];
      else nextColors[range] = color;
    } else {
      nextRanges.push(range);
      if (color != null) nextColors[range] = color;
    }
    return { ranges: nextRanges, colors: nextColors };
  }
  function dimPaintValue(color) {
    const index = LINE_COLORS.indexOf(normalizeLineColor(color));
    return index === -1 ? DIM_PAINT_DEFAULT : DIM_PAINT_DEFAULT + index + 1;
  }
  function dimPaintColorName(value) {
    if (typeof value !== "number" || value <= DIM_PAINT_DEFAULT) return null;
    return LINE_COLORS[value - DIM_PAINT_DEFAULT - 1] ?? null;
  }

  // src/vendor/gametree.js
  var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var boardCache = {};
  function nodeMerger(node, data) {
    if ((data.B == null || node.data.B == null || data.B[0] !== node.data.B[0]) && (data.W == null || node.data.W == null || data.W[0] !== node.data.W[0])) {
      return null;
    }
    return { ...data, ...node.data };
  }
  function getRootProperty(tree, property, fallback = null) {
    let result = "";
    if (property in tree.root.data) result = tree.root.data[property][0];
    return result === "" ? fallback : result;
  }
  function getGameInfo(tree) {
    let komi = getRootProperty(tree, "KM");
    if (komi != null && !isNaN(komi)) komi = +komi;
    else komi = null;
    let size = getRootProperty(tree, "SZ");
    if (size == null) {
      size = [19, 19];
    } else {
      const parts = size.toString().split(":");
      size = [+parts[0], +parts[parts.length - 1]];
    }
    let handicap = getRootProperty(tree, "HA", 0);
    handicap = Math.max(1, Math.min(9, Math.round(handicap)));
    if (handicap === 1) handicap = 0;
    const playerNames = ["B", "W"].map(
      (x) => getRootProperty(tree, `P${x}`) || getRootProperty(tree, `${x}T`)
    );
    const playerRanks = ["BR", "WR"].map((x) => getRootProperty(tree, x));
    return {
      playerNames,
      playerRanks,
      blackName: playerNames[0],
      blackRank: playerRanks[0],
      whiteName: playerNames[1],
      whiteRank: playerRanks[1],
      gameName: getRootProperty(tree, "GN"),
      eventName: getRootProperty(tree, "EV"),
      gameComment: getRootProperty(tree, "GC"),
      date: getRootProperty(tree, "DT"),
      result: getRootProperty(tree, "RE"),
      komi,
      handicap,
      size
    };
  }
  function setGameInfo(tree, data) {
    let newTree = tree.mutate((draft) => {
      if ("size" in data) {
        if (data.size) {
          let value = data.size.map(
            (x) => isNaN(x) || !x ? 19 : Math.min(25, Math.max(2, x))
          );
          if (value[0] === value[1]) value = value[0].toString();
          else value = value.join(":");
          draft.updateProperty(draft.root.id, "SZ", [value]);
        } else {
          draft.removeProperty(draft.root.id, "SZ");
        }
      }
    });
    return newTree.mutate((draft) => {
      const props = {
        blackName: "PB",
        blackRank: "BR",
        whiteName: "PW",
        whiteRank: "WR",
        gameName: "GN",
        eventName: "EV",
        gameComment: "GC",
        date: "DT",
        result: "RE",
        komi: "KM",
        handicap: "HA"
      };
      for (const key in props) {
        if (!(key in data)) continue;
        let value = data[key];
        if (value && value.toString() !== "") {
          if (key === "komi") {
            if (isNaN(value)) value = 0;
          } else if (key === "handicap") {
            const board = getBoard(newTree, newTree.root.id);
            const stones = board.getHandicapPlacement(+value);
            value = stones.length;
            if (value <= 1) {
              draft.removeProperty(draft.root.id, props[key]);
              draft.removeProperty(draft.root.id, "AB");
              continue;
            }
            draft.updateProperty(draft.root.id, "AB", stones.map(import_sgf2.stringifyVertex));
          }
          draft.updateProperty(draft.root.id, props[key], [value.toString()]);
        } else {
          draft.removeProperty(draft.root.id, props[key]);
        }
      }
    });
  }
  function getMatrixDict(tree) {
    const matrix = [...Array(tree.getHeight() + 1)].map(() => []);
    const dict = {};
    const inner = (node, xshift, yshift) => {
      const sequence = [...tree.getSequence(node.id)];
      let hasCollisions = true;
      while (hasCollisions) {
        hasCollisions = false;
        for (let y = 0; y <= sequence.length; y += 1) {
          if (xshift >= matrix[yshift + y].length - (y === sequence.length)) continue;
          hasCollisions = true;
          xshift += 1;
          break;
        }
      }
      for (let y = 0; y < sequence.length; y += 1) {
        matrix[yshift + y][xshift] = sequence[y].id;
        dict[sequence[y].id] = [xshift, yshift + y];
      }
      const last = sequence[sequence.length - 1];
      for (let k = 0; k < last.children.length; k += 1) {
        inner(last.children[k], xshift + k, yshift + sequence.length);
      }
      return [matrix, dict];
    };
    return inner(tree.root, 0, 0);
  }
  function getMatrixWidth(y, matrix) {
    const keys = [...Array(10)].map((_, i) => i + y - 4).filter((i) => i >= 0 && i < matrix.length);
    const padding = Math.min(
      ...keys.map((i) => {
        for (let j = 0; j < matrix[i].length; j += 1) {
          if (matrix[i][j] != null) return j;
        }
        return 0;
      })
    );
    const width = Math.max(...keys.map((i) => matrix[i].length)) - padding;
    return [width, padding];
  }
  function getBoard(tree, id) {
    const treePositions = [];
    let board = null;
    for (const node of tree.listNodesVertically(id, -1, {})) {
      if (boardCache[node.id] != null && node.id !== id) {
        board = boardCache[node.id];
        break;
      }
      treePositions.unshift(node.id);
    }
    if (!board) {
      let size = [19, 19];
      if (tree.root.data.SZ != null) {
        const value = tree.root.data.SZ[0];
        if (value.includes(":")) size = value.split(":");
        else size = [value, value];
        size = size.map((x) => isNaN(x) ? 19 : +x);
      }
      board = (0, import_go_board.fromDimensions)(...size);
    }
    const inner = (currentTree, nodeId, baseboard) => {
      const node = currentTree.get(nodeId);
      if (node == null) return null;
      const parent = node.parentId != null ? currentTree.get(node.parentId) : null;
      let vertex = null;
      let nextBoard = null;
      const moveProps = { B: 1, W: -1 };
      for (const prop in moveProps) {
        if (node.data[prop] == null) continue;
        vertex = (0, import_sgf2.parseVertex)(node.data[prop][0]);
        nextBoard = baseboard.makeMove(moveProps[prop], vertex);
        nextBoard.currentVertex = vertex;
        break;
      }
      if (!nextBoard) nextBoard = baseboard.clone();
      const setupProps = { AW: -1, AE: 0, AB: 1 };
      for (const prop in setupProps) {
        if (node.data[prop] == null) continue;
        for (const value of node.data[prop]) {
          for (const setupVertex of (0, import_sgf2.parseCompressedVertices)(value)) {
            if (!nextBoard.has(setupVertex)) continue;
            nextBoard.set(setupVertex, setupProps[prop]);
          }
        }
      }
      let dimmedRanges;
      let dimmedColors;
      if (node.data.DD != null) {
        dimmedRanges = node.data.DD.map(normalizeDimValue).filter((x) => x !== "");
        dimmedColors = parseDimColors(node.data.SBKDD, dimmedRanges);
      } else {
        dimmedRanges = baseboard.dimmedRanges || [];
        dimmedColors = baseboard.dimmedColors || {};
      }
      Object.assign(nextBoard, {
        markers: nextBoard.signMap.map((row) => row.map(() => null)),
        lines: [],
        dimmedRanges,
        dimmedColors,
        dimmed: toDimEntries(dimmedRanges, dimmedColors),
        childrenInfo: [],
        siblingsInfo: []
      });
      if (vertex != null && nextBoard.has(vertex)) {
        const [x, y] = vertex;
        nextBoard.markers[y][x] = { type: "point" };
      }
      const markerProps = { CR: "circle", MA: "cross", SQ: "square", TR: "triangle" };
      for (const prop in markerProps) {
        if (node.data[prop] == null) continue;
        for (const value of node.data[prop]) {
          for (const [x, y] of (0, import_sgf2.parseCompressedVertices)(value)) {
            if (nextBoard.markers[y] == null) continue;
            nextBoard.markers[y][x] = { type: markerProps[prop] };
          }
        }
      }
      if (node.data.LB != null) {
        for (const composed of node.data.LB) {
          const sep = composed.indexOf(":");
          const point = composed.slice(0, sep);
          const label = composed.slice(sep + 1);
          const [x, y] = (0, import_sgf2.parseVertex)(point);
          if (nextBoard.markers[y] == null) continue;
          nextBoard.markers[y][x] = { type: "label", label };
        }
      }
      if (node.data.L != null) {
        for (let i = 0; i < node.data.L.length; i += 1) {
          const point = node.data.L[i];
          const label = alpha[i];
          if (label == null) return;
          const [x, y] = (0, import_sgf2.parseVertex)(point);
          if (nextBoard.markers[y] == null) continue;
          nextBoard.markers[y][x] = { type: "label", label };
        }
      }
      for (const type of ["AR", "LN"]) {
        if (node.data[type] == null) continue;
        for (const composed of node.data[type]) {
          const { points, color } = parseLineValue(composed);
          const [v1, v2] = points.map(import_sgf2.parseVertex);
          nextBoard.lines.push({
            v1,
            v2,
            type: type === "AR" ? "arrow" : "line",
            color
          });
        }
      }
      const addInfo = (child, list) => {
        let v;
        let sign;
        if (child.data.B != null) {
          v = (0, import_sgf2.parseVertex)(child.data.B[0]);
          sign = 1;
        } else if (child.data.W != null) {
          v = (0, import_sgf2.parseVertex)(child.data.W[0]);
          sign = -1;
        } else {
          return;
        }
        if (!nextBoard.has(v)) return;
        let type = null;
        if (child.data.BM != null) type = "bad";
        else if (child.data.DO != null) type = "doubtful";
        else if (child.data.IT != null) type = "interesting";
        else if (child.data.TE != null) type = "good";
        list[v] = { sign, type };
      };
      for (const child of node.children) addInfo(child, nextBoard.childrenInfo);
      if (parent != null) {
        for (const sibling of parent.children) {
          addInfo(sibling, nextBoard.siblingsInfo);
        }
      }
      boardCache[nodeId] = nextBoard;
      return nextBoard;
    };
    for (const nodeId of treePositions) {
      board = inner(tree, nodeId, board);
    }
    return board;
  }
  function clearBoardCache() {
    boardCache = {};
  }
  function getPlayer(tree, id) {
    let node = tree.get(id);
    while (node != null) {
      if (node.data.PL != null) return node.data.PL[0] === "W" ? -1 : 1;
      if (node.data.B != null) return -1;
      if (node.data.W != null) return 1;
      if (node.parentId == null) break;
      node = tree.get(node.parentId);
    }
    return 1;
  }
  function getMoveNumber(tree, id) {
    let count = 0;
    let node = tree.get(id);
    while (node != null) {
      if (node.data.B != null || node.data.W != null) count += 1;
      if (node.parentId == null) break;
      node = tree.get(node.parentId);
    }
    return count;
  }
  function getPath(tree, id) {
    const path = [];
    let node = tree.get(id);
    while (node != null) {
      path.unshift(node);
      if (node.parentId == null) break;
      node = tree.get(node.parentId);
    }
    return path;
  }

  // src/sabaki-entry.js
  function createIdGenerator(start = 1) {
    let id = start;
    return () => id++;
  }
  window.SabakiLibs = {
    GameTree: import_immutable_gametree2.default,
    Board: import_go_board2.default,
    sgf,
    createIdGenerator,
    ...gametree_exports,
    ...linecolor_exports,
    ...dim_exports
  };
})();
