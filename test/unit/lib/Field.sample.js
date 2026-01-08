
export const field1Props = {
  id: 'first',
  bundleID: 'test',
  label: 'A Field',
  key: 'first',
  type: 'text',
  terms: ['one', '1st'],
  geometry: ['point', 'area'],
  placeholder: 'Enter a value...'
};

export const field2Props = {
  id: 'second',
  label: '{first}',
  dummy: '{dummy}',
  key: 'second',
  type: 'text',
  terms: ['two', '2nd'],
  geometry: ['point', 'area'],
  placeholder: '{first}'
};

export const field1Strings = {
  id: 'first',
  label: 'A Field',
  terms: ['one', '1st'],
  placeholder: 'Enter a value...'
};

export const field2Strings = {
  id: 'second',
  label: 'A Field',
  terms: ['two', '2nd'],
  placeholder: 'Enter a value...'
};
