class SynapseBase<T> {
  private _keySubscribers: Partial<Record<keyof T, Array<() => void>>>;
  private _subscribers: Array<() => void>;

  constructor() {
    this._keySubscribers = {};
    this._subscribers = [];
  }

  subscribe(subscriber: () => void) {
    // Prevention of double subscription prevention is not implemented
    // reason: looking through the whole array on every subscription felt expensive
    this._subscribers.push(subscriber);
  }

  unsubscribe(subscriber: () => void) {
    const index = this._subscribers.indexOf(subscriber);
    if (index !== -1) {
      // For maximum efficiency of O(1)
      // replace the subscriber with the last subscriber and then shorten the array
      this._subscribers[index] =
        this._subscribers[this._subscribers.length - 1];
      this._subscribers.pop();
    }
  }

  subscribeKey(key: keyof T, subscriber: () => void) {
    // Check `subscribe` for why double subscriptions are not prevented
    if (!this._keySubscribers[key]) {
      // Create the array if it doesn't exist
      this._keySubscribers[key] = [subscriber];
    } else {
      this._keySubscribers[key].push(subscriber);
    }
  }

  unsubscribeKey(key: keyof T, subscriber: () => void) {
    const keySubscribers = this._keySubscribers[key];

    if (!keySubscribers) return;

    const index = keySubscribers.indexOf(subscriber);
    if (index !== -1) {
      // For maximum efficiency of O(1)
      // replace the subscriber with the last subscriber and then shorten the array
      this._subscribers[index] =
        this._subscribers[this._subscribers.length - 1];
      this._subscribers.pop();
    }
  }

  trigger() {
    // Queue invocations of general subscribers
    for (let i = 0; i < this._subscribers.length; i++) {
      queueMicrotask(this._subscribers[i]);
    }
  }

  triggerKey(key: keyof T) {
    // Queue invocations of key subscribers
    const propSubscribers = this._keySubscribers[key];
    if (propSubscribers) {
      for (let i = 0; i < propSubscribers.length; i++) {
        queueMicrotask(propSubscribers[i]);
      }
    }
  }
}

// Type wrapper because of usage of Object.assign
export type Synapse<T> = SynapseBase<T> & T;

export type SynapseConfig = {
  subscribeToInnerInitial: boolean;
  subscribeToInnerAssigned: boolean;
  convertInitial: boolean;
};

const DEFAULT_CONFIG: SynapseConfig = {
  subscribeToInnerInitial: true,
  subscribeToInnerAssigned: true,
  convertInitial: true,
} as const;

export function synapse<T extends object>(
  initialValue: T,
  config?: Partial<SynapseConfig>,
): Synapse<T> {
  // Don't allow creating synapses of synapses
  // convertInitial is dependent on this logic because it automatically converts _every_ object
  if (initialValue instanceof SynapseBase) {
    return initialValue;
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };

  const synapseObject = new SynapseBase() as Synapse<T>;

  if (cfg.subscribeToInnerInitial || cfg.convertInitial) {
    // Copy over all the values from the initial value
    // while creating subscriptions for synapse objects

    // Idk if this can be done in a faster way (probably yes)
    // previously used Object.assign but then can't check for instances of synapses
    const initialKeys = Object.keys(initialValue) as (keyof T)[];

    for (let i = 0; i < initialKeys.length; i++) {
      const initialKey = initialKeys[i];
      let valueOfKey = initialValue[initialKey];

      if (cfg.convertInitial && valueOfKey instanceof Object) {
        // If the value is an object and synapse conversion is enabled convert the value to a synapse
        valueOfKey = synapse(valueOfKey);
      }

      // Bypass strict intersection assignment checks
      (synapseObject as any)[initialKey] = valueOfKey;

      if (cfg.subscribeToInnerInitial && valueOfKey instanceof SynapseBase) {
        // Create a single global scope subscriber
        valueOfKey.subscribe(() => {
          // That causes a global update of target
          synapseObject.trigger.bind(synapseObject)();
          // And an update of that specific key
          synapseObject.triggerKey.bind(synapseObject, initialKey)();
        });
      }
    }
  } else {
    Object.assign(synapseObject, initialValue);
  }

  return new Proxy<Synapse<T>>(synapseObject, {
    set(target, prop, newValue) {
      // I assume something will be super broken if this assertion wasn't true
      const key = prop as keyof T;

      // Execute global trigger on the synapse
      target.trigger();

      // Execute key trigger on the synapse
      target.triggerKey(key);

      if (cfg.subscribeToInnerAssigned) {
        // Check if the value getting set is a synapse
        // if so connect to it
        if (newValue instanceof SynapseBase) {
          // Create a single global scope subscriber
          newValue.subscribe(() => {
            // That causes a global update of target
            target.trigger.bind(target)();
            // And an update of that specific key
            target.triggerKey.bind(target, key)();
          });
        }
      }

      // Actually run the internal set method
      return Reflect.set(...arguments);
    },
  });
}
