// Customer-facing copy shared by host packages. Reading metadata performs no requests.
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pluginSignupUrl,pluginApiKeysUrl} from './client-info.mjs';

export async function readListing(root) {
  const path=join(root,'listing.json'),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Listing metadata must be a bounded regular file');
  const value=JSON.parse(await readFile(path,'utf8'));
  for(const field of ['displayName','summary','shortDescription','longDescription','apiKeyHelp']) {
    if(typeof value[field]!=='string'||!value[field].trim())throw Error(`Missing listing ${field}`);
  }
  if(value.summary.length>160||/https?:|utm_/.test(value.summary))throw Error('Listing summary must be concise product copy');
  for(const field of ['defaultPrompts','skillsOnlyPrompts']) {
    if(!Array.isArray(value[field])||value[field].length!==3||value[field].some(v=>typeof v!=='string'||!v.trim()))throw Error(`Listing requires three ${field}`);
  }
  if(!Array.isArray(value.capabilities)||value.capabilities.some(v=>!v.title||!v.description))throw Error('Listing capabilities are required');
  return value;
}
export function renderListingReadme(listing,{label='your coding agent',source='other-agent',installNotes='',skillsOnly=false}={}) {
  return `# ${listing.displayName}\n\n${listing.longDescription}\n\n${installNotes?`## Install and configure\n\n${installNotes}\n\n`:''}## Try it in ${label}\n\n${(skillsOnly?listing.skillsOnlyPrompts:listing.defaultPrompts).map(prompt=>`- “${prompt}”`).join('\n')}\n\n## What you can build\n\n${listing.capabilities.map(c=>`- **${c.title}.** ${c.description}`).join('\n')}\n\n## Connect your account\n\n[Create an Inworld account](${pluginSignupUrl(source,'readme')}) or [get your API key](${pluginApiKeysUrl(source,'readme')}), ${skillsOnly ? "then configure it in your app's secret settings when building an API integration. This skills-only package does not provide native MCP credential settings, and its terminal adapter never forwards API keys." : "then configure it in your agent's approved Inworld credential settings."} Keep the key out of chat and version control.\n\n${skillsOnly ? "This package provides integration skills and local checks. Authenticated Inworld tool calls require a separately configured MCP-capable host." : "The plugin uses one Inworld connection for its supported tools; no second API key or feature-area package is needed."} Preparing text and test scenarios can stay offline. Generation, uploads, voice training and other writes run only when requested. Native audio playback depends on your agent. It helps the agent build with Inworld; native providers powering the agent itself are separate integrations.\n\n## Data and services\n\nAPI tools send the selected text, audio, prompts and settings to Inworld; routing can use upstream model providers. Documentation search sends its query to Inworld's docs service. Local preparation stays local until an authorized upload. The coding agent's own data handling follows its host. Requests identify the plugin and host separately from the CLI SDK; no install beacon or additional analytics SDK is included.\n\n[Installation](https://github.com/inworld-ai/plugin/blob/main/INSTALL.md) · [Updates](https://github.com/inworld-ai/plugin/blob/main/UPDATING.md) · [Documentation](https://docs.inworld.ai) · [Support](https://docs.inworld.ai/portal/support) · [Privacy](https://inworld.ai/privacy)\n`;
}
