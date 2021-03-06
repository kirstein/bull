/*eslint-env node */
'use strict';

var expect = require('chai').expect;
var utils = require('./utils');
var sinon = require('sinon');
var redis = require('ioredis');

var ONE_SECOND = 1000;
var ONE_MINUTE = 60 * ONE_SECOND;
var ONE_HOUR = 60 * ONE_MINUTE;
var ONE_DAY = 24 * ONE_HOUR;
var ONE_MONTH = 31 * ONE_DAY;

describe('repeat', function () {
  var queue;

  beforeEach(function(){
    this.clock = sinon.useFakeTimers();
    var client = new redis();
    return client.flushdb().then(function(){
      queue = utils.buildQueue('repeat', {settings: {
        guardInterval: Number.MAX_VALUE,
        stalledInterval: Number.MAX_VALUE,
        drainDelay: 1 // Small delay so that .close is faster.
      }});
    });
  });

  afterEach(function(){
    this.clock.restore();
    return queue.close();
  });

  it('should create multiple jobs if they have the same cron pattern', function(done) {
    var cron = '*/10 * * * * *';
    var customJobIds = ['customjobone', 'customjobtwo'];

    Promise.all([
      queue.add({}, { jobId: customJobIds[0], repeat: { cron: cron }}),
      queue.add({}, { jobId: customJobIds[1], repeat: { cron: cron }})
    ]).then(function() {
      return queue.count();
    }).then(function(count) {
      expect(count).to.be.eql(2);
      done();
    }).catch(done);
  });

  it('should get repeatable jobs with different cron pattern', function(done) {
    var crons = ['10 * * * * *', '2 * * 1 * 2', '1 * * 5 * *', '2 * * 4 * *'];

    Promise.all([
      queue.add('first', {}, { repeat: { cron: crons[0], endDate: 12345 }}),
      queue.add('second', {}, { repeat: { cron: crons[1], endDate: 54321 }}),
      queue.add('third', {}, { repeat: { cron: crons[2], tz: 'Africa/Abidjan' }}),
      queue.add('fourth', {}, { repeat: { cron: crons[3], tz: 'Africa/Accra' }}),
    ]).then(function() {
      return queue.getRepeatableCount();
    }).then(function(count){
      expect(count).to.be.eql(4);
      return queue.getRepeatableJobs(0, -1, true);
    }).then(function(jobs){
      expect(jobs).to.be.and.an('array').and.have.length(4);
      expect(jobs[0]).to.include({cron: '2 * * 1 * 2', next: 2000, endDate: 54321});
      expect(jobs[1]).to.include({cron: '10 * * * * *', next: 10000, endDate: 12345 });
      expect(jobs[2]).to.include({cron: '2 * * 4 * *', next: 259202000, tz: 'Africa/Accra'});
      expect(jobs[3]).to.include({cron: '1 * * 5 * *', next: 345601000, tz: 'Africa/Abidjan'});
      done();
    }).catch(done);
  });

  it('should repeat every 2 seconds', function (done) {
    var _this = this;
    var date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    var nextTick = 2 * ONE_SECOND + 500;

    queue.add('repeat', {foo: 'bar'}, { repeat: {cron: '*/2 * * * * *'}}).then(function(){
      _this.clock.tick(nextTick);
    });

    queue.process('repeat', function(){
      // dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job){
      _this.clock.tick(nextTick);
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
      counter ++;
      if(counter == 20){
        done();
      }
    });
  });

  it('should repeat once a day for 5 days', function (done) {
    var _this = this;
    //this.timeout(50000);
    var date = new Date('2017-05-05 13:12:00');
    this.clock.tick(date.getTime());
    var nextTick = ONE_DAY;

    queue.add('repeat', {foo: 'bar'}, {repeat: {
      cron: '0 1 * * *',
      endDate: new Date('2017-05-10 13:12:00')}
    }).then(function(){
      _this.clock.tick(nextTick);
    });

    queue.process('repeat', function(){
      // Dummy
    });

    var prev;
    var counter = 0;
    queue.on('completed', function(job){
      _this.clock.tick(nextTick);
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_DAY);
      }
      prev = job;

      counter ++;
      if(counter == 5){
        queue.getWaiting().then(function(jobs){
          expect(jobs.length).to.be.eql(0);
          queue.getDelayed().then(function(jobs){
            expect(jobs.length).to.be.eql(0);
            done();
          });
        });
      }
    });
  });

  it('should repeat 7:th day every month at 9:25', function (done) {
    var _this = this;
    var date = new Date('2017-02-02 7:21:42');
    this.clock.tick(date.getTime());

    queue.add('repeat', {foo: 'bar'}, { repeat: {cron: '* 25 9 7 * *'}}).then(function(){
      _this.clock.tick(ONE_MONTH);
    });

    queue.process('repeat', function(){
      // Dummy
    });

    var counter = 20;
    var prev;
    queue.on('completed', function(job){
      if(prev){
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_MONTH);
      }
      prev = job;

      counter --;
      if(counter == 0){
        done();
      }
      _this.clock.tick(ONE_MONTH);
    });
  });

  it('should create two jobs with the same ids', function(){
    var options = {
      repeat: {
        cron: '0 1 * * *',
      },
    };

    var p1 = queue.add({foo: 'bar'}, options);
    var p2 = queue.add({foo: 'bar'}, options);

    return Promise.all([p1, p2]).then(function(jobs) {
      expect(jobs.length).to.be.eql(2);
      expect(jobs[0].id).to.be.eql(jobs[1].id);
    });
  });
});
