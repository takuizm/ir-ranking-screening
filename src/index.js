const { runSurvey, buildOptionsFromArgs } = require('./full');

async function cli(argv = process.argv.slice(2)) {
  try {
    const options = buildOptionsFromArgs(argv);
    await runSurvey(options);
  } catch (error) {
    console.error('実行中にエラーが発生しました:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  cli();
}

module.exports = {
  cli,
  runSurvey,
  buildOptionsFromArgs,
};
