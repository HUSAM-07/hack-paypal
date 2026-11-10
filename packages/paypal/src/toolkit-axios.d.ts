// The axios instance the Agent Toolkit loads; `./toolkit.ts` installs its bridge adapter on it.
declare const axios: { defaults: { adapter?: unknown }; getAdapter?: (a: unknown) => unknown };
export default axios;
