/** Cache asynchronous component imports while allowing a failed load to retry. */
export function createToolLoader(loaders) {
  const loaded = new Map();
  const pending = new Map();

  return {
    get(id) {
      return loaded.get(id) ?? null;
    },

    load(id) {
      if (loaded.has(id)) return Promise.resolve(loaded.get(id));
      if (pending.has(id)) return pending.get(id);
      const load = loaders[id];
      if (!load) return Promise.reject(new Error(`Unknown tool: ${id}`));

      const request = Promise.resolve()
        .then(() => load())
        .then((module) => {
          const component = module?.default ?? module;
          loaded.set(id, component);
          pending.delete(id);
          return component;
        })
        .catch((error) => {
          pending.delete(id);
          throw error;
        });
      pending.set(id, request);
      return request;
    },
  };
}
