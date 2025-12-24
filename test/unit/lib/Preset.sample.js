// Some fields
export const nameProps = { id: 'name', label: 'Name', key: 'name', type: 'text' };
export const phoneProps = { id: 'phone', label: 'Phone', key: 'phone', type: 'tel' };
export const shoppingProps = { id: 'shopping', label: 'Shopping', key: 'shopping', type: 'check' };
export const secondhandProps = { id: 'second_hand', label: 'Second-hand', key: 'second_hand', type: 'check' };


// Some normal presets
export const shopProps = {
  id: 'shop',
  name: 'Shop',
  icon: 'maki-shop',
  geometry: ['point', 'area'],
  fields: ['name', 'shopping', 'fake1'],
  moreFields: ['phone', 'fake2'],
  tags: {
    shop: '*'
  },
  matchScore: 0.4
};

export const thriftProps = {
  id: 'shop/second_hand',
  name: 'Thrift Store',
  icon: '{shop}',
  dummy: '{dummy}',
  geometry: ['point', 'area'],
  terms: ['resale', 'second-hand', 'used'],
  aliases: ['Thrift Shop', 'Consignment Store', 'Resale Shop', 'Secondhand Shop'],
  fields: ['{shop}', 'second_hand', '{dummy1}'],
  moreFields: ['{shop}', '{dummy2}'],
  tags: {
    shop: 'second_hand'
  }
};

export const coffeeProps = {
  id: 'amenity/cafe/coffee_shop',
  name: 'Coffeehouse',
  icon: 'temaki-hot_drink_cup',
  geometry: ['point', 'area'],
  fields: ['name'],
  moreFields: ['phone'],
  tags: {
    amenity: 'cafe',
    cuisine: 'coffee_shop'
  },
  reference: {
    key: 'cuisine',
    value: 'coffee_shop'
  }
};

// A "suggestion" preset
export const starbucksProps = {
  id: 'amenity/cafe/coffee_shop/starbucks-795f60',
  name: 'Starbucks (USA)',
  locationSet: { 'include': ['us'] },
  icon: 'temaki-hot_drink_cup',
  geometry: ['point', 'area'],
  matchScore: 2,
  suggestion: true,
  imageURL: 'https://graph.facebook.com/Starbucks/picture?type=large',
  terms: ['starbucks', 'starbucks us', 'starbucks coffee'],
  reference: {
    key: 'cuisine',
    value: 'coffee_shop'
  },
  tags: {
    'amenity': 'cafe',
    'brand:wikidata': 'Q37158',
    'cuisine': 'coffee_shop'
  },
  addTags: {
    'amenity': 'cafe',
    'brand': 'Starbucks',
    'brand:wikidata': 'Q37158',
    'cuisine': 'coffee_shop',
    'name': 'Starbucks',
    'official_name': 'Starbucks Coffee',
    'takeaway': 'yes'
  }
};


export const thriftStrings = {
  id: 'shop/second_hand',
  type: 'preset',
  suggestion: false,
  name: 'Thrift Store',
  terms: ['resale', 'second-hand', 'used'],
  aliases: ['Thrift Shop', 'Consignment Store', 'Resale Shop', 'Secondhand Shop'],
  primary: 'thrift,store',
  alternate: 'resale,second,hand,used,shop,consignment,secondhand'
};

export const starbucksStrings = {
  id: 'amenity/cafe/coffee_shop/starbucks-795f60',
  type: 'preset',
  suggestion: true,
  name: 'Starbucks',
  terms: ['starbucks', 'starbucks us', 'starbucks coffee'],
  aliases: [],
  primary: 'Starbucks,starbucks,starbucks us,starbucks coffee',
  alternate: 'cafe,Q37158,coffee_shop'
};
