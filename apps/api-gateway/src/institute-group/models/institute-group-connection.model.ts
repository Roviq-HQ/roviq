import { createConnectionType } from '../../common/pagination/relay-pagination.model';
import { InstituteGroupModel } from './institute-group.model';

export const { ConnectionType: InstituteGroupConnection, EdgeType: InstituteGroupEdge } =
  createConnectionType(InstituteGroupModel, 'InstituteGroup');
