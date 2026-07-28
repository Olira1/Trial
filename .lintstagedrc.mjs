/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.ts': ['eslint --fix', 'prettier --write'],
  '*.{js,mjs,cjs,json,md,yml,yaml}': ['prettier --write'],
};
