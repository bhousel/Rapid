import { Glob } from 'bun';
import { Validator, Schema } from 'jsonschema';
import { styleText } from 'node:util';

await validateJSON();


// Validate the Rapid data files
async function validateJSON(): Promise<void> {
  const START = '🔎   ' + styleText('yellow', 'Validating json…');
  const END = '👍  ' + styleText('green', 'json validated');
  let hasErrors = false;

  console.log('');
  console.log(START);
  console.time(END);

  // Create a validator
  const validator = new Validator();

  // Load all schema files
  let main: Schema | undefined;
  const glob = new Glob('./data/schema/*.schema.json');
  for (const filepath of glob.scanSync()) {
    const contents = await Bun.file(filepath).json();
    if (/main\.schema\.json/.test(filepath)) {
      main = contents as Schema;  // found the main schema
    } else {
      validator.addSchema(contents);
    }
  }
  if (main === undefined) {
    console.error(styleText('red', `Error - missing 'main.schema.json'`));
    process.exit(1);
  }

  // Validate the data files
  const toValidate = [
    './data/editor_layer_index.json',
    './data/osm_rulesets.json5',
    './data/rapid_imagery.json5',
    './data/rapid_schema.json5',
    './data/rapid_style.json5'
  ];

  for (const filepath of toValidate) {
    const contents = Bun.JSON5.parse(await Bun.file(filepath).text());
    const validationErrors = validator.validate(contents, main, { nestedErrors: true }).errors;

    if (validationErrors.length) {
      hasErrors = true;
      console.error(styleText('red', '\nError - Schema validation:'));
      console.error('  ' + styleText('yellow', filepath + ': '));
      for (const e of validationErrors) {
        if (e.property) {
          console.error('  ' + styleText('yellow', e.property + ' ' + e.message));
        } else {
          console.error('  ' + styleText('yellow', e.message));
        }
      }
      console.error();
    }
  }

  console.timeEnd(END);

  if (hasErrors) {
    process.exit(1);
  }
}
