import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactionGuide,CompactionReader} from '../compaction.mjs';

const sol={context_window:500000,max_context_window:872000,effective_context_window_percent:95};
const astra={...sol,context_window:272000};

test('the reference line uses the raw model window, effective config and recorded capacity',()=>{
  assert.deepEqual(compactionGuide({window:475000,used:100000},sol,{}),{threshold:450000,remaining:350000});
  assert.deepEqual(compactionGuide({window:258400,used:250000},astra,{}),{threshold:244800,remaining:0});
  assert.deepEqual(compactionGuide({window:828400,used:224300},sol,{model_context_window:900000}),
    {threshold:784800,remaining:560500});
  assert.equal(compactionGuide({window:475000},sol,{model_auto_compact_token_limit:350000}).threshold,350000);
  assert.equal(compactionGuide({window:475000},sol,{model_post_turn_compact_threshold_percent:80}).threshold,380000);
  assert.equal(compactionGuide({window:475000},{...sol,auto_compact_token_limit:310000},{}).threshold,310000);
});

test('unresolved or unsupported settings have no colored threshold; paths stay in the backend',()=>{
  const report={window:475000,used:100000,model:'gpt-6.2-sol',cwd:'local/path'};
  assert.equal(compactionGuide(report,sol,{model_context_window:872000}),null);
  assert.equal(compactionGuide(report,sol,{model_auto_compact_token_limit_scope:'body_after_prefix'}),null);
  assert.equal(compactionGuide(report,sol,{features:{async_compaction:true}}),null);
  assert.equal(compactionGuide(report,sol,{model_catalog_json:'another-models.json'}),null);
  assert.equal(compactionGuide(report,null,{}),null);
  assert.equal(compactionGuide(report,sol,null),null);
  const reader=new CompactionReader('.',async()=>null);
  assert.equal(Object.hasOwn(reader.decorate(report),'cwd'),false);
});
