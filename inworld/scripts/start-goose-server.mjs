// Goose recipe entry point: one Inworld connection and one declared key.
const [server,...extra]=process.argv.slice(2);
if(extra.length||server!=='inworld')throw Error('Select inworld');
process.env.INWORLD_CLIENT_SOURCE='goose-plugin';
process.env.INWORLD_SKILL_PREFIX='inworld-';
await import('../launcher.mjs');
