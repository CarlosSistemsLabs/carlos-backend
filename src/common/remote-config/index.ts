/**
 * Public interface of the Remote Config module (task 33.5, Requirement 14.7).
 *
 * Exposes the {@link IRemoteConfigService} abstraction (the feature-flag /
 * dynamic-configuration seam), its Firebase-backed default implementation, and a
 * static implementation for disabled/test wiring. See {@link remote-config-service}
 * for how it degrades gracefully to caller-supplied defaults when Firebase is
 * disabled and how environment separation (Requirement 14.7) is achieved via the
 * env-scoped Firebase Admin client.
 */
export {
  FirebaseRemoteConfigService,
  StaticRemoteConfigService,
} from './remote-config-service.js';
export type {
  IRemoteConfigService,
  RemoteConfigLogger,
} from './remote-config-service.js';
