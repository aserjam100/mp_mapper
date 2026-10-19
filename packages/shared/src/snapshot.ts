/**
 * Read-only site: `pnpm site:build` saves the response of each read-only API path as a JSON file, and
 * the static build of the web app reads that file instead of calling the API. Both sides use this.
 *   /curricula                        -> /data/curricula.json
 *   /editions/AU2/locations?grade=3   -> /data/editions/AU2/locations/3.json
 */
export function snapshotFile(apiPath: string): string {
  const [path = '', query = ''] = apiPath.split('?');
  const grade = /^grade=(\d+)$/.exec(query);
  if (query && !grade) throw new Error(`No snapshot file for ${apiPath}`);
  return `/data${path}${grade ? `/${grade[1]}` : ''}.json`;
}
