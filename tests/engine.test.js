'use strict';
/* 计时引擎单元测试：node --test tests/  */

const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

/** 造一局并返回便捷操作对象（时间由我们手动推进，绝对可控） */
function game(config) {
  const state = E.newGame(config);
  let now = 1_000_000; // 任意起点
  return {
    state,
    get now() { return now; },
    at(ms) { now += ms; return now; },
    to(t) { now = t; return now; },
    start(side) { return E.start(state, now, side); },
    press(side) { return E.press(state, side, now); },
    pause() { return E.pause(state, now); },
    resume() { return E.resume(state, now); },
    flag() { return E.checkFlag(state, now); },
    left(side) { return E.remainingMs(state, side, now); }
  };
}

test('初始状态：双方都是基础时间，未开表不倒计时', () => {
  const g = game({ mode: 'fischer', baseMs: 300_000, incMs: 3_000 });
  assert.equal(g.left('w'), 300_000);
  assert.equal(g.left('b'), 300_000);
  g.at(60_000); // 开表前干等 60 秒
  assert.equal(g.left('w'), 300_000, '未开表不应消耗时间');
  assert.equal(g.flag(), null);
});

test('费舍尔加秒：走完一步立即给自己加秒，对方开始倒计时', () => {
  const g = game({ mode: 'fischer', baseMs: 300_000, incMs: 3_000 });
  g.start('w');
  g.at(10_000);                       // 白方思考 10 秒
  const r = g.press('w');
  assert.equal(r.type, 'move');
  assert.equal(g.left('w'), 293_000); // 300 - 10 + 3
  assert.equal(g.state.moves.w, 1);
  assert.equal(g.state.active, 'b');
  g.at(4_000);                        // 黑方思考 4 秒
  g.press('b');
  assert.equal(g.left('b'), 299_000); // 300 - 4 + 3
  assert.equal(g.left('w'), 293_000, '非活动方时间不应变化');
});

test('第一步也享有加秒（与 FIDE 规则一致）', () => {
  const g = game({ mode: 'fischer', baseMs: 60_000, incMs: 30_000 });
  g.start('w');
  g.at(1_000);
  g.press('w');
  assert.equal(g.left('w'), 89_000); // 60 - 1 + 30
});

test('无加秒模式：走一步只扣时间', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000, incMs: 5_000 });
  g.start('w');
  g.at(2_000);
  g.press('w');
  assert.equal(g.left('w'), 58_000);
  assert.equal(g.state.cfg.incMs, 0, '无加秒模式下加秒配置应被清零');
});

test('布朗斯坦延时：每步前 N 秒不计时', () => {
  const g = game({ mode: 'delay', baseMs: 300_000, delayMs: 5_000 });
  g.start('w');
  g.at(3_000);                       // 思考 3 秒 < 5 秒延时
  assert.equal(g.left('w'), 300_000, '延时内时间不动');
  g.at(5_000);                       // 累计 8 秒
  assert.equal(g.left('w'), 297_000, '只扣超出延时的 3 秒');
  const r = g.press('w');
  assert.equal(r.type, 'move');
  assert.equal(g.left('w'), 297_000);
  g.at(20_000);                      // 黑方这一手超时思考
  g.press('b');
  assert.equal(g.left('b'), 285_000); // 300 - (20-5)
});

test('按在非活动方的一侧不产生任何效果', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000 });
  g.start('w');
  g.at(1_000);
  const r = g.press('b');            // 白方在走，却按了黑方
  assert.equal(r.type, 'ignored');
  assert.equal(r.reason, 'not-active');
  assert.equal(g.state.moves.b, 0);
  assert.equal(g.state.active, 'w');
  assert.equal(g.left('w'), 59_000);
});

test('同一次触摸被重复投递时会被去抖忽略', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000 });
  g.start('w');
  g.at(1_000);
  assert.equal(g.press('w').type, 'move');
  g.at(10);                          // 10ms 后「黑方」按键（不可能的真实走子）
  const r = g.press('b');
  assert.equal(r.type, 'ignored');
  assert.equal(r.reason, 'debounced');
  assert.equal(g.state.active, 'b', '棋盘状态不应被误改');
});

test('暂停会先结算已用时间，恢复后继续走', () => {
  const g = game({ mode: 'fischer', baseMs: 300_000, incMs: 0 });
  g.start('w');
  g.at(7_000);
  g.pause();
  assert.equal(g.left('w'), 293_000);
  g.at(600_000);                     // 暂停期间过去 10 分钟
  assert.equal(g.left('w'), 293_000, '暂停期间不计时');
  assert.equal(g.flag(), null);
  g.resume();
  g.at(3_000);
  assert.equal(g.left('w'), 290_000);
  assert.equal(g.state.cfg.incMs, 0);
});

test('暂停时按钟无效', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000 });
  g.start('w');
  g.at(1_000);
  g.pause();
  const r = g.press('w');
  assert.equal(r.type, 'ignored');
  assert.equal(r.reason, 'paused');
});

test('超时判定：时间耗尽即判负，之后不再变化', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000 });
  g.start('w');
  g.at(59_000);
  assert.equal(g.flag(), null);
  g.at(1_000);
  assert.equal(g.flag(), 'w');
  assert.equal(g.state.finished, true);
  assert.equal(g.left('w'), 0);
  assert.equal(g.left('b'), 60_000, '胜方时间不动');
  g.at(60_000);
  assert.equal(g.flag(), null, '已结束不再重复判负');
});

test('超时后再按钟不会把时间「救回来」', () => {
  const g = game({ mode: 'fischer', baseMs: 60_000, incMs: 30_000 });
  g.start('w');
  g.at(60_500);                      // 已经超时
  const r = g.press('w');
  assert.equal(r.type, 'flag');
  assert.equal(r.side, 'w');
  assert.equal(g.state.moves.w, 0, '超时的那一步不算走子');
  assert.equal(g.state.finished, true);
});

test('页面被挂起很久（定时器被冻结）后仍能算出正确的超时方', () => {
  const g = game({ mode: 'fischer', baseMs: 180_000, incMs: 2_000 });
  g.start('w');
  g.at(1_000);
  g.press('w');                      // 白方走完，黑方开始走
  const beforeSleep = g.left('b');
  assert.equal(beforeSleep, 180_000);
  g.at(10 * 60_000);                 // 手机息屏 10 分钟后回到前台
  assert.equal(g.flag(), 'b');       // 黑方早已超时
  assert.equal(g.state.flagged, 'b');
});

test('超时方在最后一刻按键：先判超时，不享受加秒', () => {
  const g = game({ mode: 'fischer', baseMs: 10_000, incMs: 5_000 });
  g.start('w');
  g.at(10_000);
  const r = g.press('w');
  assert.equal(r.type, 'flag');
  assert.equal(g.left('w'), 0);
});

test('未开表时按任意一方 = 开表，且不算走子', () => {
  const g = game({ mode: 'sudden', baseMs: 60_000 });
  const r = g.press('w');
  assert.equal(r.type, 'start');
  assert.equal(r.side, 'w');
  assert.equal(g.state.moves.w, 0);
  assert.equal(g.state.started, true);
  assert.equal(E.start(g.state, g.now, 'w').type, 'ignored', '不能重复开表');
});

test('加秒不会因为长时间思考而变成负数', () => {
  const g = game({ mode: 'fischer', baseMs: 5_000, incMs: 3_000 });
  g.start('w');
  g.at(4_999);
  g.press('w');
  assert.equal(g.left('w'), 3_001);  // 5 - 4.999 + 3
});

test('时间格式化模仿实体钟：小时/分钟/十分之一秒', () => {
  assert.equal(E.formatTime(600_000), '10:00');
  assert.equal(E.formatTime(599_900), '10:00');   // 向上取整
  assert.equal(E.formatTime(59_000), '0:59');
  assert.equal(E.formatTime(3_600_000), '1:00:00');
  assert.equal(E.formatTime(3_661_000), '1:01:01');
  assert.equal(E.formatTime(20_000), '0:20');
  assert.equal(E.formatTime(19_900), '19.9');
  assert.equal(E.formatTime(0), '0.0');
  assert.equal(E.formatTime(-5), '0.0');
  assert.equal(E.formatTime(NaN), '0.0');
});

test('配置规范化：非法输入会被夹到合法区间', () => {
  const cfg = E.normalizeConfig({ mode: 'nonsense', baseMs: -1, incMs: 999_999 });
  assert.equal(cfg.mode, 'fischer');
  assert.equal(cfg.baseMs, E.MIN_BASE_MS);
  assert.equal(cfg.incMs, E.MAX_ADD_MS);

  const delayCfg = E.normalizeConfig({ mode: 'delay', baseMs: 60_000, delayMs: 10_000 });
  assert.equal(delayCfg.incMs, 0);
  assert.equal(delayCfg.delayMs, 10_000);
});

test('完整一局：10+5 走 60 回合后时间账目正确', () => {
  const g = game({ mode: 'fischer', baseMs: 600_000, incMs: 5_000 });
  g.start('w');
  for (let i = 0; i < 60; i++) {
    g.at(2_000);
    assert.equal(g.press(i % 2 === 0 ? 'w' : 'b').type, 'move');
  }
  // 每方各走 30 步，每步耗时 2 秒、加 5 秒 → 净赚 3 秒/步
  assert.equal(g.left('w'), 600_000 + 30 * 3_000);
  assert.equal(g.left('b'), 600_000 + 30 * 3_000);
  assert.equal(g.state.moves.w, 30);
  assert.equal(g.state.moves.b, 30);
});

/* ================= Byoyomi 读秒 ================= */

test('读秒：主时间阶段不消耗段数，主时间用完后才进入读秒', () => {
  const g = game({ mode: 'byoyomi', baseMs: 60_000, byoyomiMs: 30_000, byoyomiPeriods: 1 });
  g.start('w');
  assert.equal(E.readout(g.state, 'w', g.now).phase, 'main');
  g.at(20_000);
  const r = E.readout(g.state, 'w', g.now);
  assert.equal(r.phase, 'main');
  assert.equal(r.ms, 40_000);
  assert.equal(r.periodsLeft, 1);
  g.press('w');
  assert.equal(g.state.periods.w, 1, '主时间内走子不消耗读秒段');
  assert.equal(g.left('w'), 40_000);
});

test('读秒：单段制，超出读秒额度即判负', () => {
  const g = game({ mode: 'byoyomi', baseMs: 10_000, byoyomiMs: 30_000, byoyomiPeriods: 1 });
  g.start('w');
  g.at(10_000 + 29_000); // 主时间用尽，读秒用掉 29 秒
  assert.equal(E.readout(g.state, 'w', g.now).phase, 'byoyomi');
  assert.equal(E.readout(g.state, 'w', g.now).periodsLeft, 1);
  assert.equal(E.readout(g.state, 'w', g.now).ms, 1_000);
  assert.equal(g.flag(), null, '还没超出读秒');
  g.at(1_000); // 读秒满 30 秒
  assert.equal(g.flag(), 'w');
  assert.equal(g.state.finished, true);
  assert.equal(E.readout(g.state, 'w', g.now).ms, 0);
});

test('读秒：多段制 5×30 秒 = 可以超时思考 4 次，第 5 次判负', () => {
  const X = 30_000;
  const g = game({ mode: 'byoyomi', baseMs: 1_000, byoyomiMs: X, byoyomiPeriods: 5 });
  g.start('w');
  g.at(1_000); // 主时间用尽
  assert.equal(E.readout(g.state, 'w', g.now).phase, 'byoyomi');
  assert.equal(E.readout(g.state, 'w', g.now).periodsLeft, 5);

  for (let n = 1; n <= 4; n++) {
    g.at(X); // 又超出一整格
    const r = E.readout(g.state, 'w', g.now);
    assert.equal(r.periodsLeft, 5 - n, '第 ' + n + ' 次超时后应剩 ' + (5 - n) + ' 段');
    assert.equal(r.ms, X, '窗口应重新满格');
    assert.equal(g.flag(), null, '还有剩余段数就不该判负');
  }
  g.at(X); // 第 5 次超时
  assert.equal(g.flag(), 'w');
  assert.equal(g.state.periods.w, 0);
});

test('读秒：每步重新满格，剩的时间不累积', () => {
  const g = game({ mode: 'byoyomi', baseMs: 60_000, byoyomiMs: 30_000, byoyomiPeriods: 1 });
  g.start('w');
  g.at(60_000 + 20_000); // 读秒用掉 20 秒，还剩 10 秒时落子
  assert.equal(E.readout(g.state, 'w', g.now).ms, 10_000);
  assert.equal(g.press('w').type, 'move');
  assert.equal(g.state.periods.w, 1, '没超时就不消耗段数');
  assert.equal(g.state.ms.w, 0, '主时间已耗尽');
  g.at(5_000);
  g.press('b');
  const info = E.readout(g.state, 'w', g.now);
  assert.equal(info.phase, 'byoyomi');
  assert.equal(info.ms, 30_000, '下一手重新满格，不累积上一手剩下的 10 秒');
});

test('读秒：主时间中途耗尽时，这一手可用「剩余主时间 + 一格读秒」', () => {
  const g = game({ mode: 'byoyomi', baseMs: 60_000, byoyomiMs: 30_000, byoyomiPeriods: 1 });
  g.start('w');
  g.at(58_000);
  g.press('w'); // 白方走完，只剩 2 秒主时间
  assert.equal(g.left('w'), 2_000);
  g.at(5_000);
  g.press('b'); // 轮到白方，这一手总共可用 2 + 30 = 32 秒
  g.at(31_000);
  assert.equal(E.readout(g.state, 'w', g.now).ms, 1_000, '读了 31 秒，读秒窗口还剩 1 秒');
  assert.equal(g.flag(), null);
  g.at(1_000);
  assert.equal(g.flag(), 'w', '累计 32 秒 = 2 秒主时间 + 30 秒读秒');
});

test('读秒：读秒阶段落子会扣掉已经用掉的段数', () => {
  const g = game({ mode: 'byoyomi', baseMs: 1_000, byoyomiMs: 30_000, byoyomiPeriods: 5 });
  g.start('w');
  g.at(1_000 + 65_000); // 主时间 1 秒 + 读秒 65 秒 → 跨过 2 段
  assert.equal(g.press('w').type, 'move');
  assert.equal(g.state.periods.w, 3, '5 - 2 = 3 段');
  assert.equal(g.state.ms.w, 0);
  assert.equal(E.readout(g.state, 'w', g.now).ms, 30_000, '下一手满格');
});

test('读秒：非活动方主时间已耗尽时，钟上预备一格满读秒', () => {
  const g = game({ mode: 'byoyomi', baseMs: 5_000, byoyomiMs: 20_000, byoyomiPeriods: 2 });
  g.start('w');
  g.at(6_000);
  g.press('w'); // 白方耗尽主时间走完，轮到黑方
  const w = E.readout(g.state, 'w', g.now);
  assert.equal(w.phase, 'byoyomi');
  assert.equal(w.ms, 20_000);
  assert.equal(w.periodsLeft, 2);
  const b = E.readout(g.state, 'b', g.now);
  assert.equal(b.phase, 'main');
  assert.equal(b.ms, 5_000);
});

test('读秒：暂停会扣掉已跨过的段数，恢复后当前窗口重新开始', () => {
  const g = game({ mode: 'byoyomi', baseMs: 1_000, byoyomiMs: 10_000, byoyomiPeriods: 3 });
  g.start('w');
  g.at(1_000);
  g.at(12_000); // 读秒用掉 12 秒 → 跨过 1 段
  assert.equal(E.readout(g.state, 'w', g.now).periodsLeft, 2);
  g.pause();
  assert.equal(g.state.periods.w, 2);
  g.at(50_000); // 暂停期间不走表
  assert.equal(g.state.periods.w, 2);
  g.resume();
  assert.equal(E.readout(g.state, 'w', g.now).ms, 10_000, '恢复后当前窗口满格，裁判停表不该让选手白丢读秒');
  g.at(10_000);
  assert.equal(g.flag(), null);
  assert.equal(E.readout(g.state, 'w', g.now).periodsLeft, 1);
  g.at(10_000);
  assert.equal(g.flag(), 'w');
});

test('读秒：超时后再按钟不能把段数「救回来」', () => {
  const g = game({ mode: 'byoyomi', baseMs: 1_000, byoyomiMs: 10_000, byoyomiPeriods: 1 });
  g.start('w');
  g.at(1_000 + 11_000);
  const r = g.press('w');
  assert.equal(r.type, 'flag');
  assert.equal(g.state.periods.w, 0);
  assert.equal(g.state.finished, true);
});

test('读秒：页面被挂起很久后仍能判出正确的超时方', () => {
  const g = game({ mode: 'byoyomi', baseMs: 60_000, byoyomiMs: 30_000, byoyomiPeriods: 1 });
  g.start('w');
  g.at(61_000);
  g.press('w'); // 白方进入读秒，轮到黑方
  g.at(30 * 60_000); // 手机息屏 30 分钟
  assert.equal(g.flag(), 'b', '黑方主时间早就没了，读秒也早超了');
});

test('读秒：配置夹取与文字描述', () => {
  const cfg = E.normalizeConfig({ mode: 'byoyomi', baseMs: 3_600_000, byoyomiMs: 30_000, byoyomiPeriods: 5 });
  assert.equal(cfg.mode, 'byoyomi');
  assert.equal(cfg.incMs, 0);
  assert.equal(cfg.delayMs, 0);
  assert.equal(cfg.byoyomiMs, 30_000);
  assert.equal(cfg.byoyomiPeriods, 5);
  assert.equal(E.describeConfig(cfg), '60 分钟 + 读秒 30 秒 × 5 段 · Byoyomi 读秒');

  const single = E.normalizeConfig({ mode: 'byoyomi', baseMs: 300_000, byoyomiMs: 0, byoyomiPeriods: 0 });
  assert.equal(single.byoyomiMs, E.MIN_BYOYOMI_MS, '读秒 0 秒会被夹到最小 1 秒');
  assert.equal(single.byoyomiPeriods, 1);
  assert.equal(E.describeConfig(single), '5 分钟 + 读秒 1 秒 · Byoyomi 读秒');
});

test('readout：非读秒模式统一返回主时间阶段', () => {
  const g = game({ mode: 'fischer', baseMs: 60_000, incMs: 5_000 });
  g.start('w');
  g.at(3_000);
  const r = E.readout(g.state, 'w', g.now);
  assert.equal(r.phase, 'main');
  assert.equal(r.ms, 57_000);
  assert.equal(r.periodsLeft, null);
  assert.equal(r.windowIndex, 0);
});
