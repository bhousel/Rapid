
// A normal preset
export const presetProps = {
  id: 'shop/second_hand',
  name: 'Thrift Store',
  icon: 'maki-shop',
  geometry: ['point', 'area'],
  terms: ['resale', 'second-hand', 'used'],
  aliases: ['Thrift Shop', 'Consignment Store', 'Resale Shop', 'Secondhand Shop'],
  fields: ['{shop}', 'second_hand'],
  tags: {
    shop: 'second_hand'
  }
};

// A "suggestion" preset
export const suggestionProps = {
  id: 'amenity/cafe/coffee_shop/starbucks-795f60',
  name: 'Starbucks (USA)',
  locationSet: { 'include': ['us'] },
  icon: 'temaki-hot_drink_cup',
  geometry: ['point', 'area'],
  matchScore: 2,
  suggestion: true,
  imageURL: 'https://graph.facebook.com/StarbucksPhilippines/picture?type=large',
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

// A preset with a '*' tag
export const starProps = {
  id: 'traffic_calming',
  icon: 'temaki-diamond',
  fields: ['traffic_calming'],
  geometry: ['vertex'],
  tags: {
    traffic_calming: '*'
  },
  matchScore: 0.4
};


export const presetStrings = {
  id: 'shop/second_hand',
  type: 'preset',
  suggestion: false,
  name: 'Thrift Store',
  terms: ['resale', 'second-hand', 'used'],
  aliases: ['Thrift Shop', 'Consignment Store', 'Resale Shop', 'Secondhand Shop'],
  primary: 'thrift,store',
  alternate: 'resale,second,hand,used,shop,consignment,secondhand'
};

export const suggestionStrings = {
  id: 'amenity/cafe/coffee_shop/starbucks-795f60',
  type: 'preset',
  suggestion: true,
  name: 'Starbucks',
  terms: ['starbucks', 'starbucks us', 'starbucks coffee'],
  aliases: [],
  primary: 'Starbucks,starbucks,starbucks us,starbucks coffee',
  alternate: 'cafe,Q37158,coffee_shop'
};
