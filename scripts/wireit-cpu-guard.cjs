const os = require('os');

const originalCpus = os.cpus.bind(os);
os.cpus = (...args) => {
  const result = originalCpus(...args);
  if (Array.isArray(result) && result.length > 0) {
    return result;
  }
  // Return a single placeholder CPU entry so concurrency calculations stay positive.
  return [{ model: 'virtual', speed: 0 }];
};

if (typeof os.availableParallelism === 'function') {
  const originalAvailableParallelism = os.availableParallelism.bind(os);
  os.availableParallelism = (...args) => {
    try {
      const count = originalAvailableParallelism(...args);
      if (typeof count === 'number' && count > 0) {
        return count;
      }
    } catch (error) {
      // Ignore and fall back to 1.
    }
    return 1;
  };
}

if (!process.env.UV_THREADPOOL_SIZE || Number.parseInt(process.env.UV_THREADPOOL_SIZE, 10) <= 0) {
  process.env.UV_THREADPOOL_SIZE = '1';
}
