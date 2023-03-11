import { parse as recastParse } from 'recast';
import { Path } from 'ast-types';

import typescriptParser from 'recast/parsers/typescript.js';

const DBG = false;

function isArray(arr) {
  return Array.isArray(arr);
}

/**
 * @param {string} code
 *
 * @return {any}
 */
export function parse(code) {
  return recastParse(code, {
    parser: typescriptParser
  });
}

/**
 * @param {any} node
 *
 * @return {Path}
 */
export function path(node) {
  return new Path(node);
}

/**
 * @param {string[]} strings
 * @param {...any} args
 *
 * @return { (node) => [][] }
 */
export function matcher(strings, ...args) {

  const code = strings.reduce((code, str, i) => {

    code += str;

    if (args[i]) {
      code += args[i];
    }

    return code;
  }, '');


  const ast = parse(code, {
    parser: typescriptParser
  });

  const body = path(ast.program).get('body');

  if (body.value.length !== 1) {
    throw new Error(`${ code } is more than one statement!`);
  }

  const expr = body.get(0);

  function wildcard(node) {

    if (isArray(node) && node.length === 1 && node[0].type === 'SpreadElement' && node[0].argument.name === '$$$') {
      return true;
    }

    if (isArray(node) && node.length === 1 && node[0].type === 'RestElement' && node[0].argument.name === '$$$') {
      return true;
    }

    if (node && node.type === 'BlockStatement' && node.body?.expression?.name === '$$$') {
      return true;
    }
  }

  function ident(node) {
    if (node.type === 'Identifier' && /^\$.+/.test(node.name)) {
      return node.name.substring(1);
    }

    return null;
  }

  function isNode(n) {
    return Object.prototype.toString.call(n) === '[object Object]';
  }

  function hasProperty(node, property) {
    return Object.prototype.hasOwnProperty.call(node, property);
  }

  function matchNode(node, expectedNode, results=[]) {

    const id = ident(expectedNode.value);

    if (id) {
      results[id] = node;

      return results;
    }

    const expectedNodeValue = expectedNode.value;

    const expectedKeys = Object.keys(expectedNode.value).map((k) => parseInt(k, 10) || k);

    for (const key of expectedKeys) {
      if ([ 'loc', 'start', 'end' ].includes(key)) {
        continue;
      }

      if (!hasProperty(node.value, key)) {
        DBG && console.log('BAIL no property', key);
        return;
      }

      const expectedVal = expectedNode.get(key);
      const nodeVal = node.get(key);

      if (wildcard(expectedVal.value)) {
        return results;
      }

      if (isArray(expectedVal.value)) {
        if (
          expectedVal.value.some((el, idx) => {
            return !matchNode(nodeVal.get(idx), expectedVal.get(idx), results);
          })
        ) {
          DBG && console.log('BAIL no array match', key);
          return;
        }
      } else
      if (isNode(expectedVal.value)) {
        if (!matchNode(nodeVal, expectedVal, results)) {
          DBG && console.log('BAIL no match', key);
          return;
        }
      } else {
        if (nodeVal.value !== expectedVal.value) {
          DBG && console.log('BAIL no primitive match', key);
          return;
        }
      }
    }

    return results;
  }

  return function match(nodes) {
    const matches = [];

    const keys = Object.keys(nodes.value);

    for (const key of keys) {
      const node = nodes.get(+key);
      const matched = matchNode(node, expr);

      if (matched) {
        matches.push([ node, ...matched.slice(1) ]);
      }
    }

    return matches;
  };
}