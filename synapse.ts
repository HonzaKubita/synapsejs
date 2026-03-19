// This is not a class and looks unusable because:
// assuming the user might want to create a synapse on an object that is not just primitive properties
// we will need to copy all the values (Object.assign will not copy methods) and we will possibly break the object
// so the synapse function is meant to inject the synapse functionality into the provided target
// with that said the first thing that came to mind was to create this as a class instantiate that and then
// hijack the prototype chain of the target object, this would work but it would make v8 no longer optimize the object
// which would result in performance loss
// so I made it as an object with all the properties that a synapse needs which get injected into the target object
// I still make use of the `this` because it's more convenient and I wrap all of these functions in a bind call
// so the value of `this` gets replaced with the correct target which should have all the properties the functions assume
// are defined on it because the bind functions are assigned to object compliant with the `SynapseBase` type
// The properties are handled separately because if we just copied them from here all synapses would share the non primitive properties

// In the process of writing the above text I realized I could make it a class and it would make everything much easier
// if you look into the code this class is not used as you usually use classes but rather as a convenient 3 in 1
// 1. Type definition for the synapse object method/properties
// 2. Initialization of the default values for the properties of a new synapse object
// 3. Definition of the methods for synapse object (all of these methods are shared in between all synapse instances,
// with the use of function.bind to swap the target under `this` so the correct synapse is affected)
class SynapseBase<T> {
  _isSynapse: true;
  // Synapse properties
  _keySubscribers: Partial<Record<keyof T, Array<() => void>>>;
  _subscribers: Array<() => void>;

  constructor() {
    this._isSynapse = true;
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

// Type wrapper because of usage of manual property and method injection
// like Object.assign
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

function isSynapseObject<O extends any>(o: O): o is O & SynapseBase<O> {
  return typeof o === "object" && o !== null && Object.hasOwn(o, "_isSynapse");
}

export function synapse<T extends object>(
  targetObject: T,
  config?: Partial<SynapseConfig>,
): Synapse<T> {
  // Don't allow creating synapses of synapses
  // convertInitial is dependent on this logic because it automatically converts _every_ object
  if (isSynapseObject(targetObject)) {
    return targetObject;
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Apply are the synapse methods to the object
  const base = new SynapseBase();
  // Copy properties
  Object.assign(targetObject, base);
  // Copy and bind all methods
  const baseKeys = Object.keys(base) as (keyof SynapseBase<T>)[];
  for (let i = 0; i < baseKeys.length; i++) {
    const key = baseKeys[i];
    const value = base[key];
    if (typeof value === "function") {
      (targetObject as any)[key] = value.bind(targetObject);
    }
  }

  const synapseObject = targetObject as T & SynapseBase<T>;

  if (cfg.subscribeToInnerInitial || cfg.convertInitial) {
    // Copy over all the values from the initial value
    // while creating subscriptions for synapse objects

    // Idk if this can be done in a faster way (probably yes)
    // previously used Object.assign but then can't check for instances of synapses
    const initialKeys = Object.keys(synapseObject) as (keyof T)[];

    for (let i = 0; i < initialKeys.length; i++) {
      const initialKey = initialKeys[i];
      let valueOfKey = synapseObject[initialKey];

      if (cfg.convertInitial && valueOfKey instanceof Object) {
        // If the value is an object and synapse conversion is enabled convert the value to a synapse
        valueOfKey = synapse(valueOfKey);
      }

      // Bypass strict intersection assignment checks
      (synapseObject as any)[initialKey] = valueOfKey;

      if (cfg.subscribeToInnerInitial && isSynapseObject(valueOfKey)) {
        // Create a single global scope subscriber
        valueOfKey.subscribe(() => {
          // That causes a global update of target
          synapseObject.trigger.bind(synapseObject)();
          // And an update of that specific key
          synapseObject.triggerKey.bind(synapseObject, initialKey)();
        });
      }
    }
  }

  return new Proxy<Synapse<T>>(synapseObject, {
    set(...args) {
      // This is used so later all the args can be passed to Reflect.set
      // without having to use the old `arguments` object
      const [target, prop, newValue] = args;

      // I assume something will be super broken if this assertion wasn't true
      const key = prop as keyof T;

      // Execute global trigger on the synapse
      target.trigger();

      // Execute key trigger on the synapse
      target.triggerKey(key);

      if (cfg.subscribeToInnerAssigned) {
        // Check if the value getting set is a synapse
        // if so connect to it
        if (isSynapseObject(newValue)) {
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
      return Reflect.set(...args);
    },
  });
}
