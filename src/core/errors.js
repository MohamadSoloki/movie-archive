'use strict';

// kind: 'not_found' | 'quota' | 'bad_key' | 'network'
class ProviderError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}

module.exports = { ProviderError };
