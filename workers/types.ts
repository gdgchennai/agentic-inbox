// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// POLICY_AUD and TEAM_DOMAIN come from wrangler.jsonc `vars` and are already
// present on Cloudflare.Env. app.ts fails closed when they are unset.
export type Env = Cloudflare.Env;
