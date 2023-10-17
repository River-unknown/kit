/*
 * Tests of Lightning-Engine server integration, from Lightning's perspective
 */

import test from 'ava';
import createLightningServer from '@openfn/lightning-mock';
import createWorkerServer from '../src/server';
import createMockRTE from '../src/mock/runtime-engine';
import * as e from '../src/events';

let lng;
let worker;

const urls = {
  worker: 'http://localhost:4567',
  lng: 'ws://localhost:7654/worker',
};

test.before(() => {
  // TODO give lightning the same secret and do some validation
  lng = createLightningServer({ port: 7654 });
  worker = createWorkerServer(createMockRTE('engine'), {
    port: 4567,
    lightning: urls.lng,
    secret: 'abc',
  });
});

let rollingAttemptId = 0;

const getAttempt = (ext = {}, jobs?: any) => ({
  id: `a${++rollingAttemptId}`,
  jobs: jobs || [
    {
      adaptor: '@openfn/language-common@1.0.0',
      body: JSON.stringify({ answer: 42 }),
    },
  ],
  ...ext,
});

// these are really just tests of the mock architecture, but worth having
test.serial(
  'should run an attempt through the mock runtime which returns an expression as JSON',
  async (t) => {
    return new Promise((done) => {
      const attempt = {
        id: 'attempt-1',
        jobs: [
          {
            body: JSON.stringify({ count: 122 }),
          },
        ],
      };

      lng.waitForResult(attempt.id).then((result) => {
        t.deepEqual(result, { count: 122 });
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.serial('should run an attempt which returns intial state', async (t) => {
  return new Promise((done) => {
    lng.addDataclip('x', {
      route: 66,
    });

    const attempt = {
      id: 'attempt-2',
      dataclip_id: 'x',
      jobs: [
        {
          body: 'whatever',
        },
      ],
    };

    lng.waitForResult(attempt.id).then((result) => {
      t.deepEqual(result, { route: 66 });
      done();
    });

    lng.enqueueAttempt(attempt);
  });
});

// A basic high level integration test to ensure the whole loop works
// This checks the events received by the lightning websocket
test.serial(
  'worker should pull an event from lightning, lightning should receive attempt-complete',
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt();
      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        const { final_dataclip_id } = evt.payload;
        t.assert(typeof final_dataclip_id === 'string');
        t.pass('attempt complete event received');
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.todo(`events: lightning should receive a ${e.ATTEMPT_START} event`);

// Now run detailed checks of every event
// for each event we can see a copy of the server state
// (if that helps anything?)

test.serial(`events: lightning should receive a ${e.CLAIM} event`, (t) => {
  return new Promise((done) => {
    const attempt = getAttempt();
    let didCallEvent = false;
    lng.onSocketEvent(e.CLAIM, attempt.id, ({ payload }) => {
      const { id, token } = payload;
      // Note that the payload here is what will be sent back to the worker
      // TODO check there's a token
      t.truthy(id);
      t.truthy(token);
      t.assert(typeof token === 'string');

      didCallEvent = true;
    });

    lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
      t.true(didCallEvent);
      done();
    });

    lng.enqueueAttempt(attempt);
  });
});

test.serial(
  `events: lightning should receive a ${e.GET_ATTEMPT} event`,
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt();

      let didCallEvent = false;
      lng.onSocketEvent(e.GET_ATTEMPT, attempt.id, ({ payload }) => {
        // This doesn't test that the correct attempt gets sent back
        // We'd have to add an event to the engine for that
        // (not a bad idea)
        didCallEvent = true;
      });

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        t.true(didCallEvent);
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.serial(
  `events: lightning should receive a ${e.GET_CREDENTIAL} event`,
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt({}, [
        {
          id: 'some-job',
          credential: 'a',
          adaptor: '@openfn/language-common@1.0.0',
          body: JSON.stringify({ answer: 42 }),
        },
      ]);

      let didCallEvent = false;
      lng.onSocketEvent(e.GET_CREDENTIAL, attempt.id, ({ payload }) => {
        // again there's no way to check the right credential was returned
        didCallEvent = true;
      });

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        t.true(didCallEvent);
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.serial(
  `events: lightning should receive a ${e.GET_DATACLIP} event`,
  (t) => {
    return new Promise((done) => {
      lng.addDataclip('abc', { result: true });

      const attempt = getAttempt({
        dataclip_id: 'abc',
      });

      let didCallEvent = false;
      lng.onSocketEvent(e.GET_DATACLIP, attempt.id, ({ payload }) => {
        // payload is the incoming/request payload - this tells us which dataclip
        // the worker is asking for
        // Note that it doesn't tell us much about what is returned
        // (and we can't tell from this event either)
        t.is(payload.id, 'abc');
        didCallEvent = true;
      });

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, () => {
        t.true(didCallEvent);
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

// TODO not implemented yet
test.serial.skip(
  `events: lightning should receive a ${e.RUN_START} event`,
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt();

      let didCallEvent = false;
      lng.onSocketEvent(e.RUN_START, attempt.id, ({ payload }) => {
        // TODO what can we test here?
        didCallEvent = true;
      });

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        t.true(didCallEvent);
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.serial(
  `events: lightning should receive a ${e.ATTEMPT_LOG} event`,
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt();

      let didCallEvent = false;

      // The mock runtime will put out a default log
      lng.onSocketEvent(e.ATTEMPT_LOG, attempt.id, ({ payload }) => {
        const log = payload;

        t.is(log.level, 'info');
        t.truthy(log.attempt_id);
        t.truthy(log.run_id);
        t.truthy(log.message);
        t.assert(log.message[0].startsWith('Running job'));

        didCallEvent = true;
      });

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        t.true(didCallEvent);
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.todo(`events: lightning should receive a ${e.RUN_COMPLETE} event`);

// This is well tested elsewhere but including here for completeness
test.serial(
  `events: lightning should receive a ${e.ATTEMPT_COMPLETE} event`,
  (t) => {
    return new Promise((done) => {
      const attempt = getAttempt();

      lng.onSocketEvent(e.ATTEMPT_COMPLETE, attempt.id, (evt) => {
        t.pass('called attempt:complete');
        done();
      });

      lng.enqueueAttempt(attempt);
    });
  }
);

test.todo(`should run multiple attempts`);
