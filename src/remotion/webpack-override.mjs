import { enableTailwind } from "@remotion/tailwind-v4";

/**
 *  @param {import('webpack').Configuration} currentConfig
 */
export const webpackOverride = (currentConfig) => {
  const config = enableTailwind(currentConfig);
  return {
    ...config,
    output: {
      ...(config.output || {}),
      hashFunction: "sha256",
    },
  };
};
