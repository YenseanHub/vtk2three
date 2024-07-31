export class v23Mapper {
  constructor() {
    this.actor = null;
  }
  setActor(actor) {
    this.actor = actor;
    this.mapper = actor.getMapper();
  }
  getMeshData() {
    if (this.mapper) {
      let bounds = this.mapper.getBounds();
      let input = this.mapper.getInputData();
      debugger
      console.log(input);
    }
  }
}
