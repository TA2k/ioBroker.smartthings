'use strict';

const { expect } = require('chai');
const { compactStatus } = require('./lib/compactStatus');

describe('compactStatus', () => {
  it('removes persistently empty values and empty containers', () => {
    const current = {
      component: {
        emptyString: '',
        nullValue: null,
        undefinedValue: undefined,
        emptyObject: {},
        emptyArray: [],
        power: 0,
        enabled: false,
        mode: 'cooling',
      },
    };

    expect(compactStatus(current)).to.deep.equal({
      component: {
        power: 0,
        enabled: false,
        mode: 'cooling',
      },
    });
  });

  it('keeps an empty value once when it clears a previous value', () => {
    const current = {
      component: {
        temperature: null,
        door: '',
      },
    };
    const previous = {
      component: {
        temperature: 6,
        door: 'open',
      },
    };

    expect(compactStatus(current, previous)).to.deep.equal(current);
  });

  it('removes an empty value when the previous value was already empty', () => {
    const current = {
      component: {
        temperature: null,
        door: '',
      },
    };
    const previous = {
      component: {
        temperature: null,
        door: '',
      },
    };

    expect(compactStatus(current, previous)).to.deep.equal({});
  });

  it('preserves non-empty arrays and their indexes', () => {
    const current = {
      values: [0, '', false, null],
    };

    expect(compactStatus(current)).to.deep.equal(current);
  });

  it('does not mutate current or previous payloads', () => {
    const current = { component: { value: '', enabled: false } };
    const previous = { component: { value: '', enabled: true } };
    const currentBefore = JSON.stringify(current);
    const previousBefore = JSON.stringify(previous);

    compactStatus(current, previous);

    expect(JSON.stringify(current)).to.equal(currentBefore);
    expect(JSON.stringify(previous)).to.equal(previousBefore);
  });
});
