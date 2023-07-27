import { Logger } from '@openfn/logger';
import type { Error } from '@types/node';
import { ErrorReport, JobNodeID, State } from '../types';

export type ErrorReporter = (
  state: State,
  jobId: JobNodeID,
  error: Error
) => ErrorReport;

const createErrorReporter = (logger: Logger): ErrorReporter => {
  return (state, jobId, error) => {
    const report: ErrorReport = {
      name: error.name,
      jobId,
      message: error.message,
      error: error,
    };

    if (error.code) {
      // An error coming from node will have a useful code and stack trace
      report.code = error.code as string;
      report.stack = error.stack as string;
    }

    if (report.message) {
      logger.error(
        `${report.code || report.name || 'error'}: ${report.message}`
      );
    }

    logger.error(`Check state.errors.${jobId} for details.`);
    logger.debug(error); // TODO the logger doesn't handle this very well

    if (!state.errors) {
      state.errors = {};
    }

    state.errors[jobId] = report;

    return report as ErrorReport;
  };
};

export default createErrorReporter;
