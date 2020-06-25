import sinon from 'sinon';

class ResponseMock {
  status = sinon.stub()
  send = sinon.stub()
  header = sinon.stub()
};

export default ResponseMock;
