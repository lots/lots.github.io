'use strict';
/**
 * 测试入口：单进程一次跑完所有测试（node tests/run.js）。
 * 之所以不用 `node --test tests/`：那会让 node 为每个测试文件 spawn 子进程，
 * 在受限沙箱/部分 CI 环境下会因管道权限失败。单进程等价且更稳。
 */
require('./engine.test.js');
require('./project.test.js');
