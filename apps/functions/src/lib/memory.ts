/**
 * Memory for any function that calls Drive, Sheets or Calendar. Loading the
 * functions bundle takes about 128 MiB and the lazy `googleapis` import adds
 * about 105 MiB more, so these functions ran out of memory at 256MiB.
 */
export const GOOGLEAPIS_MEMORY = '512MiB';
