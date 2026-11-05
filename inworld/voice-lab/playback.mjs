// Markdown media embeds use the host's native renderer, not an HTML artifact.
// Escape labels and path segments so filenames cannot inject Markdown markup.
export function audioEmbed(file, label) {
  if (typeof file !== 'string' || !file.startsWith('/')) throw new Error('Audio embed needs an absolute local path');
  const text = String(label).replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&');
  const target = file.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g,
    char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
  return `![${text}](${target})`;
}
