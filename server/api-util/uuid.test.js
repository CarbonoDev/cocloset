const { uuidString } = require('./uuid');

const ID = '6a87743d-33ba-43cf-a0b1-8ecf536834fa';

/**
 * WHY THIS FILE EXISTS
 *
 * Two SDKs, two `UUID` classes, and a query serializer in the Integration SDK that accepts a
 * value only if it is `instanceof` its own. A perfectly valid id, correctly transit-encoded by
 * the browser and correctly decoded here, therefore came out as
 * "Don't know how to serialize query parameter 'id': [object Object]".
 *
 * Measured against the real Dev API before this was written: an integration UUID and a plain
 * STRING both resolve; a flex-sdk UUID and a plain `{ uuid }` object both throw. So the shapes
 * below are not hypothetical - they are the four things that actually arrive here.
 */
describe('uuidString', () => {
  it('passes a plain string through', () => {
    expect(uuidString(ID)).toBe(ID);
  });

  // Neither SDK's UUID is imported here on purpose: this helper must not have an opinion about
  // which package produced the value, and both expose `.uuid`. A hand-built stand-in is the
  // honest test of that contract.
  it('unwraps an SDK UUID instance, whichever SDK made it', () => {
    class FlexUuid {
      constructor(uuid) {
        this.uuid = uuid;
        this._sdkType = 'UUID';
      }
    }
    expect(uuidString(new FlexUuid(ID))).toBe(ID);
  });

  it('unwraps the plain { uuid } object a JSON client sends', () => {
    expect(uuidString({ uuid: ID })).toBe(ID);
  });

  it('trims, because an id with whitespace is an id', () => {
    expect(uuidString(`  ${ID} `)).toBe(ID);
    expect(uuidString({ uuid: `${ID}\n` })).toBe(ID);
  });

  // NULL, not the string "undefined". Callers branch on this to send their own 400; letting a
  // missing id through would put the literal text "undefined" in a query parameter and turn a
  // clear client error into a confusing 404 from the API.
  it('answers null for anything with no usable id in it', () => {
    [undefined, null, '', '   ', {}, { uuid: '' }, { uuid: '  ' }, { uuid: 42 }, 42, []].forEach(
      value => {
        expect(uuidString(value)).toBeNull();
      }
    );
  });
});
