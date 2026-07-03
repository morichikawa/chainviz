// 実際の dockerode インスタンスを DockerClient 抽象へ橋渡しする。
// dockerode への依存はこのファイルに閉じ込め、ポーリング・正規化ロジックは
// DockerClient インターフェースだけに依存させる。

import type Docker from "dockerode";
import type {
  DockerClient,
  DockerContainerHandle,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "./types.js";

/** dockerode の Docker を DockerClient として使えるようラップする。 */
export function createDockerClient(docker: Docker): DockerClient {
  return {
    listContainers: (opts) =>
      docker.listContainers(opts) as unknown as Promise<
        DockerContainerSummary[]
      >,
    getContainer: (id): DockerContainerHandle => {
      const container = docker.getContainer(id);
      return {
        top: () => container.top() as unknown as Promise<DockerTopResult>,
        stats: (o) =>
          container.stats(o) as unknown as Promise<DockerStatsResult>,
      };
    },
  };
}
