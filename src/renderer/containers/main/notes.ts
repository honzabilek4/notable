
/* IMPORT */

import * as _ from 'lodash';
import CallsBatch from 'calls-batch';
import * as globby from 'globby';
import {Container} from 'overstated';
import Config from '@common/config';
import Utils from '@renderer/utils/utils';
import watcher from '@renderer/utils/watcher';

/* NOTES */

class Notes extends Container<NotesState, MainCTX> {

  /* VARIABLES */

  _listener;

  /* STATE */

  state = {
    notes: {}
  };

  /* LYFECYCLE */

  refresh = async () => {

    const filePaths = Utils.globbyNormalize ( await globby ( Config.notes.globs, { cwd: Config.notes.path, absolute: true } ) );

    const notes = {};

    await Promise.all ( filePaths.map ( async filePath => {

      const note = await this.ctx.note.read ( filePath );

      if ( !note ) return;

      notes[filePath] = note;

    }));

    return this.set ( notes );

  }

  listen = () => {

    if ( this._listener ) this._listener.close (); // In order to better support HMR

    const batch = new CallsBatch ({
      preflush: () => {
        this.ctx.suspend ();
        this.ctx.suspendMiddlewares ();
        optimizeBatch ( batch );
      },
      postflush: () => {
        this.ctx.unsuspend ();
        this.ctx.unsuspendMiddlewares ();
      },
      wait: 100
    });

    const optimizeBatch = ( batch ) => {
      /* GET */
      let queueNext = batch.get ();
      /* SKIPPING UPDATES ON MULTIPLE ADDITIONS */
      const lastAddIndex = _.findLastIndex ( queueNext, call => call[0] === add );
      queueNext = queueNext.map ( ( call, index ) => {
        if ( call[0] === add && index < lastAddIndex ) call[1][1] = false;
        return call;
      });
      /* SKIPPING UPDATES ON MULTIPLE DELETIONS */
      const lastDeleteIndex = _.findLastIndex ( queueNext, call => call[0] === unlink );
      queueNext = queueNext.map ( ( call, index ) => {
        if ( call[0] === unlink && index < lastDeleteIndex ) call[1][1] = false;
        return call;
      });
      /* SKIPPING UPDATES ON MULTIPLE CHANGES */
      const lastChangeIndex = _.findLastIndex ( queueNext, call => call[0] === change );
      queueNext = queueNext.map ( ( call, index ) => {
        if ( call[0] === change && index < lastChangeIndex ) call[1][1] = false;
        return call;
      });
      /* SET */
      batch.set ( queueNext );
    }

    function isFilePathSupported ( filePath ) {
      return Config.notes.re.test ( filePath );
    }

    const add = async ( filePath, _refresh?: boolean ) => {
      if ( !isFilePathSupported ( filePath ) ) return;
      const prevNote = this.ctx.note.get ( filePath );
      if ( prevNote ) return;
      const note = await this.ctx.note.read ( filePath );
      if ( !note ) return;
      await this.ctx.note.add ( note, _refresh );
    };

    const change = async ( filePath, _refresh?: boolean ) => {
      if ( !isFilePathSupported ( filePath ) ) return;
      await rename ( filePath, filePath, _refresh );
    };

    const rename = async ( filePath, nextFilePath, _refresh?: boolean ) => {
      if ( !isFilePathSupported ( nextFilePath ) ) {
        if ( isFilePathSupported ( filePath ) ) return unlink ( filePath );
        return;
      }
      const note = this.ctx.note.get ( filePath );
      if ( !note ) return add ( nextFilePath );
      const nextNote = await this.ctx.note.read ( nextFilePath );
      if ( !nextNote ) return;
      if ( this.ctx.note.is ( note, nextNote ) ) return;
      await this.ctx.note.replace ( note, nextNote, _refresh );
    };

    const unlink = async ( filePath, _refresh?: boolean ) => {
      if ( !isFilePathSupported ( filePath ) ) return;
      const note = this.ctx.note.get ( filePath );
      if ( !note ) return;
      await this.ctx.note.delete ( note, true, _refresh );
    };

    const notesPath = Config.notes.path;

    if ( !notesPath ) return;

    this._listener = watcher ( notesPath, {}, {
      add: Utils.batchify ( batch, add ),
      change: Utils.batchify ( batch, change ),
      rename: Utils.batchify ( batch, rename ),
      unlink: Utils.batchify ( batch, unlink )
    });

  }

  /* API */

  get = (): NotesObj => {

    return this.state.notes;

  }

  set = ( notes: NotesObj ) => {

    return this.setState ({ notes });

  }

}

/* EXPORT */

export default Notes;
