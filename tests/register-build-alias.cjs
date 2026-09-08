const Module = require('node:module');
const path = require('node:path');

const buildRoot = process.env.TEST_BUILD_ROOT;
if (!buildRoot) throw new Error('TEST_BUILD_ROOT is required.');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAlias(request, parent, isMain, options) {
  const mapped = request.startsWith('@/')
    ? path.join(buildRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(this, mapped, parent, isMain, options);
};