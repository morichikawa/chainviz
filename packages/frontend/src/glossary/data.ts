// Repo-root の用語データ（正となる置き場所）を Vite の `?raw` インポートで
// 取り込み、パースして Glossary にする。テストからは import されない
// （テストは parse.ts を直接叩く）。
import aInfraRaw from "@glossary/ethereum/terms/a-infra.yaml?raw";
import bNetworkRaw from "@glossary/ethereum/terms/b-network.yaml?raw";
import cTransactionRaw from "@glossary/ethereum/terms/c-transaction.yaml?raw";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";
import type { Glossary } from "./types.js";

export const glossary: Glossary = mergeGlossaries(
  parseGlossaryYaml(aInfraRaw),
  parseGlossaryYaml(bNetworkRaw),
  parseGlossaryYaml(cTransactionRaw),
);
