// Lint rules for Rapid's class member conventions (see AGENTS.md).
// They replace a typescript-eslint `naming-convention` rule and a `no-restricted-syntax` rule,
// which oxlint doesn't have. oxlint loads this file through `jsPlugins` in `.oxlintrc.json`.

const MEMBER_TYPES = [
  'MethodDefinition',
  'PropertyDefinition',
  'AccessorProperty',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSAbstractAccessorProperty',
  'TSParameterProperty'
];

function memberName(node) {
  const key = node.type === 'TSParameterProperty' ? node.parameter : node.key;
  if (node.computed) return null;
  if (key?.type === 'Identifier') return key.name;
  if (key?.type === 'AssignmentPattern' && key.left?.type === 'Identifier') return key.left.name;
  return null;
}

function visitMembers(check) {
  const visitors = {};
  for (const type of MEMBER_TYPES) {
    visitors[type] = check;
  }
  return visitors;
}

export default {
  meta: { name: 'rapid' },
  rules: {
    'no-private-members': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Use `protected` instead of `private` for class members.' },
        messages: { private: 'Use protected instead of private for class members.' }
      },
      create(context) {
        return visitMembers(node => {
          if (node.accessibility === 'private') {
            context.report({ node, messageId: 'private' });
          }
        });
      }
    },
    'protected-underscore': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Require a leading `_` on the names of protected class members.' },
        messages: { underscore: 'Protected member `{{name}}` must start with `_`.' }
      },
      create(context) {
        return visitMembers(node => {
          if (node.accessibility !== 'protected') return;
          const name = memberName(node);
          if (name && !name.startsWith('_')) {
            context.report({ node, messageId: 'underscore', data: { name } });
          }
        });
      }
    }
  }
};
