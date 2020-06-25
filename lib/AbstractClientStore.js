class AbstractClientStore {
  increment(key, lifetime, callback) {
    this.get(key, (err, value) => {
      if (err) {
        callback(err);
      } else {
        var count = value ? value.count + 1 : 1;
        this.set(
          key,
          {
            count: count,
            lastRequest: new Date(),
            firstRequest: new Date(),
          },
          lifetime,
          (err) => {
            var prevValue = {
              count: value ? value.count : 0,
              lastRequest: value ? value.lastRequest : null,
              firstRequest: value ? value.firstRequest : null,
            };
            typeof callback == 'function' && callback(err, prevValue);
          },
        );
      }
    });
  };
}

export default AbstractClientStore;
